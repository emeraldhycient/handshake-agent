import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  BuyCryptoIntent,
  SellCryptoIntent,
  SendCryptoIntent,
} from '@handshake-agent/contracts';
import {
  BuyProposalConfirmationSchema,
  SellProposalConfirmationSchema,
  SendProposalConfirmationSchema,
  SwapProposalConfirmationSchema,
} from '@handshake-agent/contracts';
import type {
  BuyProposalConfirmation,
  SellProposalConfirmation,
  SendProposalConfirmation,
  SwapProposalConfirmation,
} from '@handshake-agent/contracts';

import type {
  PricingConfig,
  PricingFeedConfig,
  ComplianceConfig,
  SwapConfig,
  CatalogConfig,
} from '../../../core/config/configuration';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import { QuotesService } from '../../quotes/application/quotes.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { WalletService } from '../../wallets/application/wallet.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  BaseRateMisconfiguredError,
  InsufficientBalanceError,
  SwapSameAssetError,
} from '../domain/execution-errors';
import {
  AmountTooLargeError,
  AmountTooSmallError,
  SelfSendError,
} from '../domain/amount-guard-errors';
import { InvalidSendAddressError } from '../domain/invalid-send-address.error';
import {
  resolveFiatMax,
  resolveFiatMin,
  resolveMinBuyFiat,
  resolveMinCryptoAmount,
  type AmountFloorConfig,
  type CryptoFloorOperation,
  type FiatBoundCapability,
} from '../domain/amount-floors';
import {
  BeneficiaryNotFoundError,
  BeneficiaryWrongTypeError,
  BeneficiaryCurrencyMismatchError,
  BeneficiaryCoolingOffError,
} from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';
import { ComplianceService } from '../../compliance/application/compliance.service';
import type {
  IProposalRepository,
  ProposalStatus,
} from './ports/proposal.repository.port';
import { PROPOSAL_REPOSITORY } from './ports/proposal.repository.port';
import type { IQuoteRepository } from './ports/quote.repository.port';
import { QUOTE_REPOSITORY } from './ports/quote.repository.port';
import type { ILedgerRepository } from './ports/ledger.repository.port';
import { LEDGER_REPOSITORY } from './ports/ledger.repository.port';
import {
  SWAP_PROVIDER,
  type ISwapProvider,
} from '../../wallets/application/ports/swap-provider.port';
import { toScaled } from '../domain/ledger';
import {
  liveStoreWhenEnabled,
  resolveEffectiveBaseRate,
} from './resolve-base-rate';
import { LiveRateStore } from '../../quotes/application/live-rate.store';

export interface CreateBuyProposalInput {
  userId: string;
  conversationId?: string;
  intent: BuyCryptoIntent;
}

export interface CreateBuyProposalOutput {
  proposalId: string;
  quoteId: string;
  confirmation: BuyProposalConfirmation;
}

export interface CreateSellProposalInput {
  userId: string;
  conversationId?: string;
  intent: SellCryptoIntent;
  /** Id of the bank-account beneficiary to pay out to. */
  beneficiaryId: string;
}

export interface CreateSellProposalOutput {
  proposalId: string;
  quoteId: string;
  confirmation: SellProposalConfirmation;
}

export type SendDestination =
  | { kind: 'saved_beneficiary'; beneficiaryId: string }
  | {
      kind: 'raw_address';
      address: string;
      network: string;
      save?: { label?: string };
    }
  // Internal (user→user, PayID) transfer — the destination is RESOLVED
  // server-side (Task 9), never supplied by the model (§3.1). `recipientUserId`
  // + `displayHandle` come from the handle resolver; `recipientDisplayName` is
  // the counterparty's resolved KYC name for the itemized confirmation.
  | {
      kind: 'internal_user';
      recipientUserId: string;
      displayHandle: string;
      recipientDisplayName: string;
    };

export interface CreateSendProposalInput {
  userId: string;
  conversationId?: string;
  intent: SendCryptoIntent;
  /** Where to send: a saved beneficiary or a user-supplied raw address (§3.1). */
  destination: SendDestination;
}

export interface CreateSendProposalOutput {
  proposalId: string;
  /** Send proposals do not persist a Quote row — the fee is stored in Proposal parameters. */
  quoteId: null;
  confirmation: SendProposalConfirmation;
}

export interface CreateSwapProposalInput {
  userId: string;
  conversationId?: string;
  /** Asset being swapped out of the user's wallet (e.g. 'USDT'). */
  fromAsset: string;
  /** Asset to receive into the user's wallet (e.g. 'TRX'). */
  toAsset: string;
  /** Human-scaled amount of fromAsset to swap (decimal string, e.g. "100"). */
  amount: string;
}

export interface CreateSwapProposalOutput {
  proposalId: string;
  quoteId: string;
  confirmation: SwapProposalConfirmation;
}

/**
 * Converts a fiat amount string and basis-point fee into a fee string rounded
 * to 2 decimal places. Uses BigInt arithmetic to avoid float drift.
 *
 * processingFeeAmount = fiatAmount * processingFeeBps / 10000, 2dp
 */
function computeProcessingFee(
  fiatAmount: string,
  processingFeeBps: number,
): string {
  // Represent fiatAmount in minor units (× 100 for 2dp) using BigInt.
  const [whole = '0', frac = ''] = fiatAmount.split('.');
  const fracPadded = frac.slice(0, 2).padEnd(2, '0');
  const fiatMinor = BigInt(whole) * 100n + BigInt(fracPadded);

  // fee in minor units: fiatMinor * processingFeeBps / 10000
  const feeMinor = (fiatMinor * BigInt(processingFeeBps)) / 10000n;

  const feeMajorWhole = feeMinor / 100n;
  const feeMajorFrac = feeMinor % 100n;
  return `${feeMajorWhole}.${String(feeMajorFrac).padStart(2, '0')}`;
}

/**
 * Adds two decimal amount strings (both 2dp) and returns a 2dp string.
 * Uses BigInt arithmetic to avoid float drift.
 */
function addFiatStrings(a: string, b: string): string {
  const toMinor = (s: string): bigint => {
    const [whole = '0', frac = ''] = s.split('.');
    const fracPadded = frac.slice(0, 2).padEnd(2, '0');
    return BigInt(whole) * 100n + BigInt(fracPadded);
  };

  const sum = toMinor(a) + toMinor(b);
  const whole = sum / 100n;
  const frac = sum % 100n;
  return `${whole}.${String(frac).padStart(2, '0')}`;
}

/**
 * Computes the SHA-256 hex digest of the canonical JSON of the parameters object.
 * Key ordering is deterministic (sorted alphabetically) so the checksum is stable.
 * NOTE: the key-sort is shallow and assumes a flat parameters object; nested
 * objects would need a recursive sort to guarantee a fully canonical encoding.
 */
function sha256Hex(parameters: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)),
  );
  const json = JSON.stringify(sorted);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Buy-proposal use-case (task 4.1, PRD §4).
 *
 * Flow:
 *   1. Call QuotesService to price the buy.
 *   2. Compute processingFeeAmount + totalFiat (decimal-safe, BigInt).
 *   3. Persist a Quote snapshot (status=valid).
 *   4. Assert the user can transact via KycGateService (§3.3 gate).
 *   5. Build parameters JSON, compute SHA-256 checksum.
 *   6. Persist a Proposal (type=buy, status=pending).
 *   7. Return { proposalId, quoteId, confirmation } (parsed through contract schema).
 *
 * The KYC gate runs BEFORE the Proposal is persisted: no Proposal is created
 * for a user who cannot transact. The Quote is already persisted at that point
 * (it is a pricing snapshot, not a commitment).
 */
@Injectable()
export class ProposalService {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly kycGate: KycGateService,
    @Inject(QUOTE_REPOSITORY)
    private readonly quoteRepo: IQuoteRepository,
    @Inject(PROPOSAL_REPOSITORY)
    private readonly proposalRepo: IProposalRepository,
    @Inject(CLOCK)
    private readonly clock: Clock,
    private readonly walletService: WalletService,
    private readonly beneficiaryService: BeneficiaryService,
    private readonly assetRegistry: AssetRegistry,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledgerRepo: ILedgerRepository,
    private readonly complianceService: ComplianceService,
    private readonly configService: EffectiveConfigService,
    @Inject(SWAP_PROVIDER)
    private readonly swapProvider: ISwapProvider,
    // @Optional so the existing unit suite (positional construction) resolves the
    // config fallback; production injects the shared live-rate store so the
    // proposal fiat-equivalent uses the SAME live rate the execution re-quote does.
    @Optional() private readonly liveRateStore?: LiveRateStore,
  ) {}

  /** Live-feed staleness window (seconds) from config, defaulting when absent. */
  private feedStalenessSec(): number {
    const feed = this.configService.get<PricingFeedConfig | undefined>(
      'pricing.feed',
    );
    return typeof feed?.stalenessSec === 'number' ? feed.stalenessSec : 900;
  }

  /** The live store honouring the admin kill-switch (null the moment enabled=false). */
  private effectiveLiveStore(): LiveRateStore | null {
    const feed = this.configService.get<PricingFeedConfig | undefined>(
      'pricing.feed',
    );
    return liveStoreWhenEnabled(this.liveRateStore, feed);
  }

  /**
   * Reads the admin-tunable amount-floor keys off the `pricing` config section.
   * Narrow read-only view (findings #3/#4) — the canonical typed home for these
   * keys is `PricingConfig`; this cast crosses that boundary safely until they
   * are added there (tracked cross-layer).
   */
  private amountFloorConfig(): AmountFloorConfig | undefined {
    return this.configService.get<AmountFloorConfig>('pricing');
  }

  /**
   * Guards a FIAT amount (buy) at the proposal boundary — BEFORE pricing/gating.
   * Rejects non-positive and below-minimum amounts with AmountTooSmallError (422)
   * so the user gets a clean, correctable message instead of an opaque 500 (#2)
   * or a confusing tier-limit 403 (#6).
   */
  private assertFiatAmountAtLeastMin(
    amount: string,
    fiatCurrency: string,
  ): void {
    const min = resolveMinBuyFiat(this.amountFloorConfig(), fiatCurrency);
    if (toScaled(amount) < toScaled(min)) {
      throw new AmountTooSmallError('buy', amount, min, fiatCurrency);
    }
  }

  /**
   * Guards a CRYPTO amount (sell/send/swap) at the proposal boundary. Rejects
   * non-positive / below-minimum / dust amounts with AmountTooSmallError (422).
   * The minimum is per-operation, per-asset and admin-tunable (#4).
   */
  private assertCryptoAmountAtLeastMin(
    operation: CryptoFloorOperation,
    amount: string,
    asset: string,
  ): void {
    const min = resolveMinCryptoAmount(
      this.amountFloorConfig(),
      operation,
      asset,
    );
    if (toScaled(amount) < toScaled(min)) {
      throw new AmountTooSmallError(operation, amount, min, asset);
    }
  }

  /**
   * Guards a transaction's FIAT VALUE against the admin-configured per-(capability,
   * asset, currency) min/max on the pricing screen — a product/market cap distinct
   * from the per-user KYC-tier limit. ENFORCE-WHEN-PRESENT: an unset bound is a
   * no-op, so this never changes behaviour until an operator sets a value. `buy`
   * bounds the fiat spend; `sell` bounds the fiat proceeds (quote.netFiatAmount).
   * Below-min → AmountTooSmallError (422); above-max → AmountTooLargeError (422).
   */
  private assertFiatWithinConfiguredBounds(
    capability: FiatBoundCapability,
    asset: string,
    fiatCurrency: string,
    fiatValue: string,
  ): void {
    const bounds =
      this.configService.get<PricingConfig>('pricing')?.assets?.[asset];
    const min = resolveFiatMin(bounds, capability, fiatCurrency);
    if (min !== null && toScaled(fiatValue) < toScaled(min)) {
      throw new AmountTooSmallError(capability, fiatValue, min, fiatCurrency);
    }
    const max = resolveFiatMax(bounds, capability, fiatCurrency);
    if (max !== null && toScaled(fiatValue) > toScaled(max)) {
      throw new AmountTooLargeError(capability, fiatValue, max, fiatCurrency);
    }
  }

  /**
   * Resolves the base-fiat (NGN) equivalent of a crypto amount for the KYC /
   * velocity money gate — BigInt-exact, fail-closed on a 0/negative/missing
   * baseRate (a zeroed fiat-equivalent would silently bypass the gate, §3.1/§3.3).
   *
   * This ~40-line money-math block is correctness-critical and was previously
   * inline in the on-chain send path; the internal-transfer path needs the exact
   * same computation, so it lives here ONCE — two copies could silently drift
   * (§13.2). Returns the resolved base fiat, the effective baseRate (kept so the
   * send path can compute its Travel-Rule fiat value without re-resolving), and
   * the exact NGN-equivalent decimal string.
   */
  private resolveGateFiatEquivalent(
    asset: string,
    cryptoAmount: string,
  ): { baseFiat: string; baseRate: number; ngnEquivalent: string } {
    // baseRate is a whole-or-fractional NGN-per-asset rate from config (e.g. 1600).
    const pricingConfig = this.configService.get<PricingConfig>('pricing');
    const baseFiat = this.assetRegistry.defaultFiat();
    // Fail closed on a missing / 0 / negative baseRate via the shared guard: a
    // zero rate would zero the fiat-equivalent and silently bypass the KYC /
    // velocity / Travel-Rule gate. Same guard as ExecutionService.
    const baseRate = resolveEffectiveBaseRate(
      pricingConfig,
      this.effectiveLiveStore(),
      asset,
      baseFiat,
      this.clock.now(),
      this.feedStalenessSec(),
    );
    // Exact decimal multiplication: cryptoAmount × baseRate. Both operands scaled
    // to 10^18 bigints, divided by SCALE once, staying in the 10^18 unit space —
    // handles fractional baseRates (e.g. 1600.45) exactly, no Math.round drift.
    const LEDGER_SCALE = 10n ** 18n;
    const scaledCrypto = toScaled(cryptoAmount);
    const scaledNgn18 =
      (scaledCrypto * toScaled(String(baseRate))) / LEDGER_SCALE;
    // Reconstruct decimal string from the 10^18-scaled bigint (mirrors fromScaled).
    const isNegNgn = scaledNgn18 < 0n;
    const absNgn = isNegNgn ? -scaledNgn18 : scaledNgn18;
    const wholeNgn = absNgn / LEDGER_SCALE;
    const fracNgn = absNgn % LEDGER_SCALE;
    const fracNgnStr =
      fracNgn === 0n
        ? ''
        : '.' + fracNgn.toString().padStart(18, '0').replace(/0+$/, '');
    const ngnEquivalent =
      (isNegNgn ? '-' : '') + wholeNgn.toString() + fracNgnStr;
    return { baseFiat, baseRate, ngnEquivalent };
  }

  /**
   * Read-only lookup of a proposal's CURRENT lifecycle status (Bug 2).
   * Returns null when the proposal no longer exists. Used by the web chat
   * history read to render an already-executed / rejected proposal's card as a
   * terminal state instead of a live, clickable quote whose confirm would 409.
   * NEVER mutates — the §3.1 model-proposes/engine-disposes invariant is intact
   * (this only reads proposal state, it does not authorize or execute).
   */
  async getProposalStatus(proposalId: string): Promise<ProposalStatus | null> {
    const record = await this.proposalRepo.findById(proposalId);
    return record ? record.status : null;
  }

  async createBuyProposal(
    input: CreateBuyProposalInput,
  ): Promise<CreateBuyProposalOutput> {
    const { userId, conversationId, intent } = input;
    const now = this.clock.now();

    // 0. Amount-floor guard (findings #2/#3/#6) — BEFORE pricing and the KYC
    // gate. A zero/dust/below-minimum buy is ordinary correctable bad input:
    // reject it as AMOUNT_TOO_SMALL (422) here so it never reaches the quote
    // domain (opaque 500) or the tier gate (confusing 403).
    this.assertFiatAmountAtLeastMin(intent.fiatAmount, intent.fiatCurrency);
    // Per-(asset, currency) product MIN/MAX on the fiat spend (enforce-when-present).
    this.assertFiatWithinConfiguredBounds(
      'buy',
      intent.asset,
      intent.fiatCurrency,
      intent.fiatAmount,
    );

    // 1. Price the buy via the quotes service.
    const quote = await this.quotesService.quoteBuy({
      asset: intent.asset,
      fiatAmount: intent.fiatAmount,
      fiatCurrency: intent.fiatCurrency,
    });

    // 2. Compute processingFeeAmount and totalFiat (BigInt-safe strings).
    const processingFeeAmount = computeProcessingFee(
      intent.fiatAmount,
      quote.processingFeeBps,
    );
    const totalFiat = addFiatStrings(intent.fiatAmount, processingFeeAmount);

    // 3. Persist the Quote snapshot.
    const expiresAt = new Date(now.getTime() + quote.expiresInSec * 1000);
    const { id: quoteId } = await this.quoteRepo.create({
      userId,
      type: 'buy',
      asset: intent.asset,
      fiatCurrency: intent.fiatCurrency,
      fiatAmount: intent.fiatAmount,
      cryptoAmount: quote.cryptoAmount,
      fxRate: quote.fxRate, // effective (spread-inclusive) rate used for conversion
      baseRate: quote.baseRate, // raw pre-spread market rate for treasury/audit
      spreadBps: quote.spreadBps,
      processingFeeBps: quote.processingFeeBps,
      processingFeeAmount,
      quotedAt: now,
      expiresAt,
    });

    // 4. KYC / velocity gate (§3.3) — BEFORE persisting the Proposal.
    // fiatAmount is the intent's exact fiat string — no Number() conversion (Fix-C).
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: intent.fiatAmount,
      fiatCurrency: intent.fiatCurrency,
      asset: intent.asset,
      capability: 'crypto.buy',
    });

    // 5. Build parameters + checksum.
    const parameters: Record<string, unknown> = {
      asset: intent.asset,
      fiatAmount: intent.fiatAmount,
      fiatCurrency: intent.fiatCurrency,
      cryptoAmount: quote.cryptoAmount,
      fxRate: quote.fxRate,
      quoteId,
    };
    const parametersChecksum = sha256Hex(parameters);

    // 6. Persist the Proposal (pending; never moves money — §3.1).
    const { id: proposalId } = await this.proposalRepo.create({
      userId,
      conversationId,
      type: 'buy',
      parameters,
      parametersChecksum,
      quoteId,
      expiresAt,
    });

    // 7. Build the itemized confirmation and parse it through the contract schema.
    const confirmation = BuyProposalConfirmationSchema.parse({
      proposalId,
      asset: intent.asset,
      fiatAmount: intent.fiatAmount,
      fiatCurrency: intent.fiatCurrency,
      cryptoAmount: quote.cryptoAmount,
      fxRate: quote.fxRate,
      spreadBps: quote.spreadBps,
      processingFeeBps: quote.processingFeeBps,
      processingFeeAmount,
      totalFiat,
      expiresAt: expiresAt.toISOString(),
    });

    return { proposalId, quoteId, confirmation };
  }

  /**
   * Sell-proposal use-case (task S4a, PRD §4).
   *
   * Flow:
   *   1. Resolve the user's (user, network) wallet (getOrProvisionNetworkWallet).
   *   2. Quote the sell (quoteSell — no side effects).
   *   3. Balance check via the ledger (authoritative running balance).
   *      → throws InsufficientBalanceError if balance < cryptoAmount.
   *   4. KYC/velocity gate on the NGN out amount (§3.3).
   *      → throws a GateError subclass if the user cannot transact.
   *   5. Beneficiary lookup (must exist + belong to the user, type bank_account).
   *      → throws BeneficiaryNotFoundError if absent.
   *   6. Persist Quote(type=sell) + Proposal(type=sell, pending).
   *   7. Return { proposalId, quoteId, confirmation } parsed through the contract schema.
   *
   * ORDER: balance + gate + beneficiary BEFORE persisting (§3.1).
   */
  async createSellProposal(
    input: CreateSellProposalInput,
  ): Promise<CreateSellProposalOutput> {
    const { userId, conversationId, intent, beneficiaryId } = input;
    const now = this.clock.now();

    // 0. Amount-floor guard (finding #4) — BEFORE quoting / balance / gate.
    // Reject a zero/dust sell with AMOUNT_TOO_SMALL (422) so it never reaches
    // confirmation.
    this.assertCryptoAmountAtLeastMin(
      'sell',
      intent.cryptoAmount,
      intent.asset,
    );

    // 1. Resolve the user's (user, network) wallet — network derived from intent asset.
    // Asset for ledger / quote comes from intent.asset (not the wallet record, which
    // no longer carries an asset field — WN-1 per-network model).
    const network = this.assetRegistry.defaultNetworkFor(intent.asset);
    const wallet = await this.walletService.getOrProvisionNetworkWallet(
      userId,
      network,
    );

    // 2. Price the sell via the quotes service.
    const quote = await this.quotesService.quoteSell({
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      fiatCurrency: intent.fiatCurrency,
    });

    // 2b. Per-(asset, currency) product MIN/MAX on the fiat PROCEEDS
    // (enforce-when-present) — the sell row's fiat value is the net fiat out.
    this.assertFiatWithinConfiguredBounds(
      'sell',
      intent.asset,
      intent.fiatCurrency,
      quote.netFiatAmount,
    );

    // 3. Balance check — ledger is the authoritative balance source.
    const balance = await this.ledgerRepo.getAccountBalance(
      'user_wallet',
      wallet.id,
      intent.asset,
    );

    if (toScaled(balance) < toScaled(intent.cryptoAmount)) {
      throw new InsufficientBalanceError(
        balance,
        intent.cryptoAmount,
        intent.asset,
      );
    }

    // 4. KYC / velocity gate on the fiat out amount (§3.3) — BEFORE persisting.
    // quote.netFiatAmount is already an exact decimal string — no Number() (Fix-C).
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: quote.netFiatAmount,
      fiatCurrency: intent.fiatCurrency,
      asset: intent.asset,
      capability: 'crypto.sell',
    });

    // 5. Beneficiary lookup — must exist and belong to the user.
    const beneficiary = await this.beneficiaryService.getById(
      userId,
      beneficiaryId,
    );
    if (beneficiary === null) {
      throw new BeneficiaryNotFoundError(beneficiaryId);
    }
    // Currency-match guard (§3.3): the bank must pay out in the SAME currency as
    // the sell, or the fiat leg settles to the wrong rail. Legacy null
    // payoutCurrency rows predate the currency dimension → treated as the catalog
    // base fiat (NGN today; post-backfill no bank row is null).
    const payoutCurrency =
      beneficiary.payoutCurrency ?? this.assetRegistry.defaultFiat();
    if (payoutCurrency !== intent.fiatCurrency) {
      throw new BeneficiaryCurrencyMismatchError(
        beneficiaryId,
        intent.fiatCurrency,
        payoutCurrency,
      );
    }
    // First-use cooling-off (B3) — same checkpoint the crypto send path uses
    // (createSendProposal step 6). An unverified bank beneficiary (name-enquiry
    // unavailable for its market) carries a cooling-off so an unverified name
    // cannot go straight onto a real payout; a name-enquiry-verified NG bank has
    // firstUseLockedUntil null and is unaffected.
    if (
      beneficiary.firstUseLockedUntil !== null &&
      beneficiary.firstUseLockedUntil > now
    ) {
      throw new BeneficiaryCoolingOffError(
        beneficiaryId,
        beneficiary.firstUseLockedUntil,
      );
    }
    // NOTE: production gates on verifiedAt / name-enquiry (beneficiary.verifiedAt !== null).
    // This skeleton accepts any beneficiary regardless of verificationStatus.

    // 6a. Persist the Quote snapshot (type=sell).
    const expiresAt = new Date(now.getTime() + quote.expiresInSec * 1000);
    const { id: quoteId } = await this.quoteRepo.create({
      userId,
      type: 'sell',
      asset: intent.asset,
      fiatCurrency: intent.fiatCurrency,
      // sell quotes carry the crypto amount as the "input"; fiatAmount is the output (net).
      fiatAmount: quote.netFiatAmount,
      cryptoAmount: intent.cryptoAmount,
      fxRate: quote.fxRate,
      baseRate: quote.baseRate,
      spreadBps: quote.spreadBps,
      processingFeeBps: quote.processingFeeBps,
      processingFeeAmount: quote.processingFeeAmount,
      quotedAt: now,
      expiresAt,
    });

    // 6b. Build parameters + checksum.
    const parameters: Record<string, unknown> = {
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      fiatCurrency: intent.fiatCurrency,
      netFiatAmount: quote.netFiatAmount,
      fxRate: quote.fxRate,
      beneficiaryId,
      walletId: wallet.id,
      quoteId,
    };
    const parametersChecksum = sha256Hex(parameters);

    // 6c. Persist the Proposal (type=sell, pending; never moves money — §3.1).
    const { id: proposalId } = await this.proposalRepo.create({
      userId,
      conversationId,
      type: 'sell',
      parameters,
      parametersChecksum,
      quoteId,
      expiresAt,
    });

    // 7. Build the itemized confirmation and parse through the contract schema.
    const beneficiaryLabel =
      beneficiary.label ||
      beneficiary.accountHolderName ||
      beneficiary.accountNumber ||
      undefined;

    const confirmation = SellProposalConfirmationSchema.parse({
      proposalId,
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      fiatCurrency: intent.fiatCurrency,
      netFiatAmount: quote.netFiatAmount,
      fxRate: quote.fxRate,
      processingFeeAmount: quote.processingFeeAmount,
      expiresAt: expiresAt.toISOString(),
      beneficiaryLabel: beneficiaryLabel ?? undefined,
    });

    return { proposalId, quoteId, confirmation };
  }

  /**
   * Send-proposal use-case (task N3a, PRD §4).
   *
   * Flow (all guards BEFORE persisting — §3.1):
   *   1. Resolve the user's (user, network) wallet (getOrProvisionNetworkWallet).
   *   2. Quote the send (quoteSend — reads config fee; no side effects).
   *      totalDebit = cryptoAmount + networkFeeCrypto
   *   3. Balance check: ledger balance ≥ totalDebit (BigInt exact).
   *      → throws InsufficientBalanceError if short.
   *   4. KYC/velocity gate on the NGN-equivalent value of the send (§3.3).
   *      → throws a GateError subclass if the user cannot transact.
   *   5. Resolve the destination address — a discriminated SendDestination:
   *      - saved_beneficiary → lookup (BeneficiaryNotFoundError / BeneficiaryWrongTypeError)
   *        + first-use cooling-off (IDN-08): firstUseLockedUntil > clock.now → BeneficiaryCoolingOffError.
   *      - raw_address → the user-confirmed address (§3.1); NO cooling-off (one-time send).
   *      Both kinds then re-run the SAME guards on the resolved toAddress:
   *      - address must pass AssetRegistry.validateAddress → else InvalidSendAddressError
   *      - self-send guard (own wallet address → SelfSendError)
   *   6. (folded into 5) Self-send + address-pattern guards run for both kinds.
   *   7. Sanctions screening:
   *      - complianceService.screenSendDestination → if !passed → SanctionsBlockedError
   *   8. Travel-Rule flag:
   *      - if fiat-equivalent value ≥ compliance.travelRuleThresholds[defaultFiat()] → requiresTravelRule = true
   *   9. Persist Proposal(type=send, pending). No Quote row for send (it is not an FX quote).
   *  10. Return { proposalId, quoteId: null, confirmation } parsed through contract schema,
   *      with the destination address masked.
   */
  async createSendProposal(
    input: CreateSendProposalInput,
  ): Promise<CreateSendProposalOutput> {
    const { userId, conversationId, intent, destination } = input;

    // Internal (user→user, PayID) transfer diverges at nearly every step — no
    // network fee, no address, self-send by userId, counterparty-user sanctions,
    // a different proposal type + confirmation — so dispatch to a focused method
    // and leave the on-chain send flow below byte-for-byte unchanged. Narrowing
    // on the `destination` const also keeps the raw_address `else` branch below
    // correctly typed (internal_user can never reach it).
    if (destination.kind === 'internal_user') {
      return this.createInternalTransferProposal({
        userId,
        conversationId,
        intent,
        destination,
      });
    }

    const now = this.clock.now();

    // 0. Amount-floor guard (finding #4) — BEFORE quoting / balance / gate.
    // Reject a zero/dust send with AMOUNT_TOO_SMALL (422).
    this.assertCryptoAmountAtLeastMin(
      'send',
      intent.cryptoAmount,
      intent.asset,
    );

    // 1. Resolve the user's (user, network) wallet — network derived from intent asset.
    // Asset for ledger / quoting comes from intent.asset (not the wallet record — WN-1).
    const network = this.assetRegistry.defaultNetworkFor(intent.asset);
    const wallet = await this.walletService.getOrProvisionNetworkWallet(
      userId,
      network,
    );

    // 2. Quote the send — flat network fee from config; no FX conversion.
    const sendQuote = this.quotesService.quoteSend({
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      network: intent.network,
    });

    const { networkFeeCrypto, totalDebit } = sendQuote;

    // 2b. Fee-coverage guard (finding #4) — the send amount must EXCEED the flat
    // network fee, else the fee dwarfs (or equals) the transfer. Reject as
    // AMOUNT_TOO_SMALL (422) with the fee as the effective minimum so the user
    // sees a meaningful floor.
    if (toScaled(intent.cryptoAmount) <= toScaled(networkFeeCrypto)) {
      throw new AmountTooSmallError(
        'send',
        intent.cryptoAmount,
        networkFeeCrypto,
        intent.asset,
      );
    }

    // 3. Balance check — ledger is authoritative. Must cover totalDebit (amount + fee).
    const balance = await this.ledgerRepo.getAccountBalance(
      'user_wallet',
      wallet.id,
      intent.asset,
    );

    if (toScaled(balance) < toScaled(totalDebit)) {
      throw new InsufficientBalanceError(balance, totalDebit, intent.asset);
    }

    // 4. KYC/velocity gate on the NGN-equivalent value of the send (§3.3).
    // Fix-C: BigInt-exact NGN equivalent via the shared helper (also fail-closes
    // on a 0/negative baseRate). baseRate is kept for the Travel-Rule fiat value.
    const {
      baseFiat,
      baseRate,
      ngnEquivalent: ngnEquivalentStr,
    } = this.resolveGateFiatEquivalent(intent.asset, intent.cryptoAmount);

    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: ngnEquivalentStr,
      fiatCurrency: baseFiat,
      asset: intent.asset,
      // A crypto-address send is on-chain + irreversible → the single on-chain send
      // cap (perSendOnChainFiatMax) applies on top of the general per-tx cap.
      onChainSend: true,
      capability: 'crypto.send',
    });

    // Keep a numeric form only for the Travel Rule threshold comparison and metadata
    // storage (those are approximate uses, not money-gate comparisons — Fix-C scope).
    const fiatValue = Number(intent.cryptoAmount) * baseRate;

    // 5. Resolve the destination address (saved beneficiary OR user-supplied raw).
    let toAddress: string;
    let beneficiaryLabel: string | undefined;
    let beneficiaryIdForParams: string | null = null;
    let saveAsBeneficiary = false;
    let saveLabel: string | undefined;

    if (destination.kind === 'saved_beneficiary') {
      beneficiaryIdForParams = destination.beneficiaryId;
      // Beneficiary lookup — must exist, belong to user, and be a crypto_address.
      const beneficiary = await this.beneficiaryService.getById(
        userId,
        destination.beneficiaryId,
      );
      if (beneficiary === null) {
        throw new BeneficiaryNotFoundError(destination.beneficiaryId);
      }
      if (beneficiary.type !== 'crypto_address') {
        throw new BeneficiaryWrongTypeError(
          destination.beneficiaryId,
          'crypto_address',
          beneficiary.type,
        );
      }
      toAddress = beneficiary.cryptoAddress!;
      beneficiaryLabel = beneficiary.label || undefined;
      // First-use cooling-off (IDN-08) — SAVED destinations only. A one-time
      // raw send is not a reusable saved destination, so it skips this.
      if (
        beneficiary.firstUseLockedUntil !== null &&
        beneficiary.firstUseLockedUntil > now
      ) {
        throw new BeneficiaryCoolingOffError(
          destination.beneficiaryId,
          beneficiary.firstUseLockedUntil,
        );
      }
    } else {
      // raw_address — the address originated from a user-confirmed field (§3.1);
      // the model never supplies it. The engine re-validates it below.
      toAddress = destination.address;
      saveAsBeneficiary = destination.save !== undefined;
      saveLabel = destination.save?.label;
    }

    // 5a. Address pattern validation — primary check for the raw branch,
    // defensive re-check for the saved branch. Same guard, both kinds (§3.3).
    if (!this.assetRegistry.validateAddress(intent.network, toAddress)) {
      throw new InvalidSendAddressError(toAddress, intent.network);
    }

    // 5b. Self-send guard (finding #5) — sending to the user's OWN provisioned
    // custodial address is a no-op transfer the masked confirmation can't expose.
    // Reject with SELF_SEND_BLOCKED (422). Compare case-insensitively so an
    // EVM-style mixed-case address still matches (TRON base58 is already
    // case-sensitive, so this only widens — never narrows — the match).
    if (toAddress.toLowerCase() === wallet.address.toLowerCase()) {
      throw new SelfSendError();
    }

    // 7. Sanctions screening on the resolved address — screen BEFORE persisting;
    // event always written. Identical for both destination kinds (§3.3).
    const screeningResult = await this.complianceService.screenSendDestination({
      userId,
      address: toAddress,
      network: intent.network,
    });
    if (!screeningResult.passed) {
      throw new SanctionsBlockedError(
        toAddress,
        screeningResult.reason,
        screeningResult.complianceEventId,
        screeningResult.complianceEventId, // reference = event id until real provider ref is available
      );
    }

    // 8. Travel-Rule flag — if fiat-equivalent ≥ configured threshold, flag it.
    const complianceConfig =
      this.configService.get<ComplianceConfig>('compliance');
    const travelRuleThreshold =
      complianceConfig?.travelRuleThresholds?.[baseFiat];
    if (travelRuleThreshold === undefined) {
      throw new Error(
        `ProposalService: missing compliance.travelRuleThresholds.${baseFiat} in config — cannot evaluate Travel Rule requirement.`,
      );
    }
    const requiresTravelRule = fiatValue >= travelRuleThreshold;

    // 9. Persist the Proposal (type=send, pending; no Quote row — not an FX quote).
    const expiresAt = new Date(now.getTime() + sendQuote.expiresInSec * 1000);

    const parameters: Record<string, unknown> = {
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      network: intent.network,
      networkFeeCrypto,
      totalDebit,
      destinationKind: destination.kind,
      beneficiaryId: beneficiaryIdForParams,
      walletId: wallet.id,
      toAddress,
      requiresTravelRule,
      ...(saveAsBeneficiary
        ? { saveAsBeneficiary: 'true', saveLabel: saveLabel ?? '' }
        : {}),
    };
    const parametersChecksum = sha256Hex(parameters);

    const { id: proposalId } = await this.proposalRepo.create({
      userId,
      conversationId,
      type: 'send',
      parameters,
      parametersChecksum,
      expiresAt,
    });

    // 10. Build the itemized confirmation and parse through the contract schema.
    // Mask the destination address: first 6 chars + '...' + last 4 chars.
    const toAddressMasked =
      toAddress.length > 10
        ? `${toAddress.slice(0, 6)}...${toAddress.slice(-4)}`
        : toAddress;

    const confirmation = SendProposalConfirmationSchema.parse({
      proposalId,
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      network: intent.network,
      networkFeeCrypto,
      totalDebit,
      toAddressMasked,
      beneficiaryLabel: beneficiaryLabel ?? undefined,
      expiresAt: expiresAt.toISOString(),
    });

    return { proposalId, quoteId: null, confirmation };
  }

  /**
   * Internal (user→user, PayID) transfer proposal — Task 6, PRD §4 / §3.1.
   *
   * A ledger-only transfer between two custodial users: NO on-chain send, NO
   * network fee, NO destination address. The model never supplies the
   * destination — `recipientUserId` + `displayHandle` are resolved server-side
   * (Task 9) and handed in. Flow (ALL guards BEFORE persisting — §3.1):
   *   a. Amount-floor / dust guard (same concern as a send; no fee-coverage
   *      guard — the fee is 0).
   *   b. Resolve the SENDER wallet for the asset's default network.
   *   c. Self-send guard FIRST (by userId) — before provisioning the recipient.
   *   d. Resolve (auto-provision) the RECIPIENT wallet on the same network.
   *   e. No network fee: networkFeeCrypto='0', totalDebit === cryptoAmount.
   *   f. Balance check: sender ledger balance ≥ totalDebit.
   *   g. KYC/velocity gate on the base-fiat-equivalent — onChainSend:false (no
   *      on-chain per-send cap), capability 'crypto.transfer' (tier_2, §3.3).
   *   h. Counterparty-USER sanctions screening (by identity, not address).
   *   i. Travel Rule does NOT apply — within-custodian (both parties are our
   *      KYC'd users, no external VASP): requiresTravelRule=false.
   *   j. Persist Proposal(type=internal_transfer, pending; no Quote row, no
   *      toAddress, no beneficiaryId).
   *   k. Return { proposalId, quoteId: null, confirmation } — instant, no address.
   */
  private async createInternalTransferProposal(input: {
    userId: string;
    conversationId?: string;
    intent: SendCryptoIntent;
    destination: Extract<SendDestination, { kind: 'internal_user' }>;
  }): Promise<CreateSendProposalOutput> {
    const { userId, conversationId, intent, destination } = input;
    const now = this.clock.now();

    // a. Amount-floor / dust guard — same concern as a send. NO fee-coverage
    // guard: an internal transfer has no network fee to dwarf the amount.
    this.assertCryptoAmountAtLeastMin(
      'send',
      intent.cryptoAmount,
      intent.asset,
    );

    // b. Resolve the SENDER wallet on the asset's default network.
    const network = this.assetRegistry.defaultNetworkFor(intent.asset);
    const senderWallet = await this.walletService.getOrProvisionNetworkWallet(
      userId,
      network,
    );

    // c. Self-send guard FIRST — by userId, BEFORE provisioning the recipient
    // wallet (a transfer to yourself is a no-op; §3.1). Reject as SELF_SEND_BLOCKED.
    if (destination.recipientUserId === userId) {
      throw new SelfSendError();
    }

    // d. Resolve (auto-provision if absent) the RECIPIENT wallet — same network.
    const recipientWallet =
      await this.walletService.getOrProvisionNetworkWallet(
        destination.recipientUserId,
        network,
      );

    // e. No network fee for an internal ledger transfer.
    const networkFeeCrypto = '0';
    const totalDebit = intent.cryptoAmount;

    // f. Balance check — ledger is authoritative; sender must cover totalDebit.
    const balance = await this.ledgerRepo.getAccountBalance(
      'user_wallet',
      senderWallet.id,
      intent.asset,
    );
    if (toScaled(balance) < toScaled(totalDebit)) {
      throw new InsufficientBalanceError(balance, totalDebit, intent.asset);
    }

    // g. KYC/velocity gate on the base-fiat-equivalent (§3.3). onChainSend:false —
    // an internal transfer never touches the chain, so the on-chain per-send cap
    // does not apply. capability 'crypto.transfer' resolves the tier_2 floor.
    const { baseFiat, ngnEquivalent } = this.resolveGateFiatEquivalent(
      intent.asset,
      intent.cryptoAmount,
    );
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: ngnEquivalent,
      fiatCurrency: baseFiat,
      asset: intent.asset,
      onChainSend: false,
      capability: 'crypto.transfer',
    });

    // h. Counterparty (recipient) sanctions screening — screened by IDENTITY
    // (there is no on-chain address); event always written (Task 8). Block on fail.
    const screen = await this.complianceService.screenCounterpartyUser({
      userId: destination.recipientUserId,
    });
    if (!screen.passed) {
      throw new SanctionsBlockedError(
        destination.displayHandle,
        screen.reason ?? undefined,
        screen.complianceEventId,
        screen.complianceEventId,
      );
    }

    // i. Travel Rule does NOT apply to a within-custodian internal transfer —
    // both parties are our KYC'd users and no external VASP is involved (FATF R16
    // targets cross-VASP transfers). requiresTravelRule stays false.

    // j. Persist the Proposal (type=internal_transfer, pending; no Quote row —
    // not an FX quote; no toAddress; no beneficiaryId). TTL mirrors the send
    // confirmation window (catalog.sendQuoteExpiresInSec, admin-tunable §7).
    const expiresInSec =
      this.configService.get<CatalogConfig>('catalog')?.sendQuoteExpiresInSec ??
      300;
    const expiresAt = new Date(now.getTime() + expiresInSec * 1000);

    const parameters: Record<string, unknown> = {
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      network,
      networkFeeCrypto,
      totalDebit,
      destinationKind: 'internal_user',
      recipientUserId: destination.recipientUserId,
      recipientWalletId: recipientWallet.id,
      walletId: senderWallet.id,
      requiresTravelRule: false,
      // Audit-snapshot the recipient's @handle + display name at propose time so
      // the settled transfer's read projections (MCP + chat) surface the
      // counterparty identity WITHOUT a read-time cross-module lookup (§3.1 —
      // resolved server-side, never model free-text).
      recipientHandle: destination.displayHandle,
      recipientDisplayName: destination.recipientDisplayName,
    };
    const parametersChecksum = sha256Hex(parameters);

    const { id: proposalId } = await this.proposalRepo.create({
      userId,
      conversationId,
      type: 'internal_transfer',
      parameters,
      parametersChecksum,
      expiresAt,
    });

    // k. Build the itemized confirmation — instant (in-custody, no on-chain wait),
    // legible via the recipient's display name + handle (NO masked address).
    const confirmation = SendProposalConfirmationSchema.parse({
      proposalId,
      asset: intent.asset,
      cryptoAmount: intent.cryptoAmount,
      network,
      networkFeeCrypto,
      totalDebit,
      recipientDisplayName: destination.recipientDisplayName,
      recipientHandle: destination.displayHandle,
      instant: true,
      expiresAt: expiresAt.toISOString(),
    });

    return { proposalId, quoteId: null, confirmation };
  }

  /**
   * Swap-proposal use-case (CLAUDE.md §3.1).
   *
   * Flow (all guards BEFORE persisting — §3.1):
   *   1. fromAsset === toAsset → SwapSameAssetError (engine rule; schema has no .refine()).
   *   2. Resolve the user's (user, network) wallet for fromAsset (getOrProvisionNetworkWallet).
   *   3. Balance check: ledger balance ≥ amount (fromAsset).
   *      → throws InsufficientBalanceError if short.
   *   4. Resolve asset provider ids via assetRegistry.assetProviderId (Blockradar).
   *   5. Call SWAP_PROVIDER.getQuote to get the live swap price.
   *   6. Fold swapSpreadBps into the displayed rate — NEVER surface spread as a line item
   *      (root CLAUDE.md §3.1). Rate returned to the user = provider rate × (1 - spreadBps/10000).
   *   7. KYC/velocity gate on the NGN-equivalent value of the fromAmount (§3.3).
   *   8. Persist Quote(type=swap) + Proposal(type=swap, pending).
   *   9. Return { proposalId, quoteId, confirmation } parsed through contract schema.
   *
   * ORDER: balance + asset resolution + quote + KYC BEFORE persisting (§3.1).
   */
  async createSwapProposal(
    input: CreateSwapProposalInput,
  ): Promise<CreateSwapProposalOutput> {
    const { userId, conversationId, fromAsset, toAsset, amount } = input;
    const now = this.clock.now();

    // 1. fromAsset === toAsset guard (engine rule, CLAUDE.md note on SwapIntentSchema).
    if (fromAsset === toAsset) {
      throw new SwapSameAssetError(fromAsset);
    }

    // 1b. Amount-floor guard (finding #4) — reject a zero/dust swap with
    // AMOUNT_TOO_SMALL (422) BEFORE the balance check and the provider call.
    this.assertCryptoAmountAtLeastMin('swap', amount, fromAsset);

    // 2. Resolve the user's (user, network) wallet for the fromAsset.
    const network = this.assetRegistry.defaultNetworkFor(fromAsset);
    const wallet = await this.walletService.getOrProvisionNetworkWallet(
      userId,
      network,
    );

    // 3. Balance check — ledger is authoritative. Must cover fromAmount.
    const balance = await this.ledgerRepo.getAccountBalance(
      'user_wallet',
      wallet.id,
      fromAsset,
    );

    if (toScaled(balance) < toScaled(amount)) {
      throw new InsufficientBalanceError(balance, amount, fromAsset);
    }

    // 4. Resolve provider asset ids for the swap call.
    const fromAssetId = this.assetRegistry.assetProviderId(
      fromAsset,
      'blockradar',
    );
    const toAssetId = this.assetRegistry.assetProviderId(toAsset, 'blockradar');

    // 5. Fetch a live swap quote from the provider.
    const swapQuote = await this.swapProvider.getQuote({
      addressId: wallet.providerReference,
      fromAssetId,
      toAssetId,
      amount,
    });

    // 6. Fold swapSpreadBps INTO the displayed rate.
    // The displayed rate is LOWER than the provider rate by spreadBps so the platform
    // captures the margin between the provider execution rate and the displayed rate.
    // NEVER surface spreadBps as a separate line item (CLAUDE.md §3.1).
    const swapConfig = this.configService.get<SwapConfig>('swap');
    const spreadBps = swapConfig?.spreadBps ?? 0;
    // effective rate = provider rate × (1 - spreadBps / 10000)
    // Exact integer/BigInt math — multiply by the integer (10000 - spreadBps)
    // then divide by 10000, instead of float-converting `1 - spreadBps/10000`
    // to a string (which introduced float drift and could not represent the
    // misconfiguration boundary precisely — finding #27).
    const providerRateScaled = toScaled(swapQuote.rate);
    const SCALE = 10n ** 18n;
    const SPREAD_DENOM = 10_000n;
    const spreadMultiplierNum = SPREAD_DENOM - BigInt(spreadBps);
    // Fail closed if the spread drives the effective rate to <= 0 (spreadBps
    // >= 100%, i.e. >= 10000). A 0/negative rate would otherwise quote a
    // 0/negative toAmount — a 0-value swap that bypasses the KYC/velocity gate
    // and debits the user for nothing (§3.1). Treat it as a pricing
    // misconfiguration rather than producing a degenerate quote.
    if (spreadMultiplierNum <= 0n || providerRateScaled <= 0n) {
      throw new BaseRateMisconfiguredError(
        fromAsset,
        this.assetRegistry.defaultFiat(),
      );
    }
    const effectiveRateScaled =
      (providerRateScaled * spreadMultiplierNum) / SPREAD_DENOM;
    // Convert back to a decimal string (2dp for rates).
    const isNegRate = effectiveRateScaled < 0n;
    const absRate = isNegRate ? -effectiveRateScaled : effectiveRateScaled;
    const wholeRate = absRate / SCALE;
    const fracRate = absRate % SCALE;
    const fracRateStr =
      fracRate === 0n
        ? ''
        : '.' + fracRate.toString().padStart(18, '0').replace(/0+$/, '');
    const effectiveRate =
      (isNegRate ? '-' : '') + wholeRate.toString() + fracRateStr;

    // Compute toAmount using the effective (spread-folded) rate.
    // fromAmount × effectiveRate = toAmount (BigInt-exact).
    const toAmountScaled = (toScaled(amount) * effectiveRateScaled) / SCALE;
    const isNegTo = toAmountScaled < 0n;
    const absTo = isNegTo ? -toAmountScaled : toAmountScaled;
    const wholeTo = absTo / SCALE;
    const fracTo = absTo % SCALE;
    const fracToStr =
      fracTo === 0n
        ? ''
        : '.' + fracTo.toString().padStart(18, '0').replace(/0+$/, '');
    const effectiveToAmount =
      (isNegTo ? '-' : '') + wholeTo.toString() + fracToStr;

    // 7. KYC/velocity gate on the NGN-equivalent of fromAmount (§3.3).
    // Use baseRate for the fromAsset. Same BigInt-exact computation as the send
    // + internal-transfer paths — shared via the one helper (§13.2, no drift).
    const { baseFiat, ngnEquivalent: ngnEquivalentStr } =
      this.resolveGateFiatEquivalent(fromAsset, amount);

    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: ngnEquivalentStr,
      fiatCurrency: baseFiat,
      asset: fromAsset,
      capability: 'crypto.swap',
    });

    // 8. Persist Quote + Proposal.
    const expiresInSec =
      swapQuote.estimatedArrivalSec > 0
        ? Math.min(swapQuote.estimatedArrivalSec, 120) // cap quote TTL at 2 min
        : 60;
    const expiresAt = new Date(now.getTime() + expiresInSec * 1000);

    // Quote row: uses toAsset as the "cryptoAmount" (amount received) and
    // fromAsset as the "asset" (what is given up). fiatAmount is the NGN equivalent.
    const { id: quoteId } = await this.quoteRepo.create({
      userId,
      type: 'swap',
      asset: fromAsset,
      fiatCurrency: baseFiat,
      fiatAmount: ngnEquivalentStr,
      cryptoAmount: amount, // fromAmount (input)
      fxRate: effectiveRate,
      baseRate: swapQuote.rate, // raw provider rate for audit
      spreadBps,
      processingFeeBps: 0,
      processingFeeAmount: '0',
      quotedAt: now,
      expiresAt,
    });

    const parameters: Record<string, unknown> = {
      fromAsset,
      toAsset,
      fromAmount: amount,
      toAmount: effectiveToAmount,
      rate: effectiveRate,
      networkFee: swapQuote.networkFee,
      transactionFee: swapQuote.transactionFee,
      estimatedArrivalSec: swapQuote.estimatedArrivalSec,
      walletId: wallet.id,
      fromAssetId,
      toAssetId,
      quoteId,
    };
    const parametersChecksum = sha256Hex(parameters);

    const { id: proposalId } = await this.proposalRepo.create({
      userId,
      conversationId,
      type: 'swap',
      parameters,
      parametersChecksum,
      quoteId,
      expiresAt,
    });

    // 9. Build itemized confirmation and parse through contract schema.
    const confirmation = SwapProposalConfirmationSchema.parse({
      proposalId,
      fromAsset,
      toAsset,
      fromAmount: amount,
      toAmount: effectiveToAmount,
      rate: effectiveRate,
      networkFee: swapQuote.networkFee,
      transactionFee: swapQuote.transactionFee,
      estimatedArrivalSec: swapQuote.estimatedArrivalSec,
      expiresAt: expiresAt.toISOString(),
    });

    return { proposalId, quoteId, confirmation };
  }
}
