import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
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
  ComplianceConfig,
  SwapConfig,
} from '../../../core/config/configuration';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import { QuotesService } from '../../quotes/application/quotes.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { WalletService } from '../../wallets/application/wallet.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  InsufficientBalanceError,
  SwapSameAssetError,
} from '../domain/execution-errors';
import {
  BeneficiaryNotFoundError,
  BeneficiaryWrongTypeError,
  BeneficiaryCoolingOffError,
} from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';
import { ComplianceService } from '../../compliance/application/compliance.service';
import type { IProposalRepository } from './ports/proposal.repository.port';
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
import { resolveBaseRate } from './resolve-base-rate';

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

export interface CreateSendProposalInput {
  userId: string;
  conversationId?: string;
  intent: SendCryptoIntent;
  /** Id of the crypto-address beneficiary to send to. */
  beneficiaryId: string;
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
  ) {}

  async createBuyProposal(
    input: CreateBuyProposalInput,
  ): Promise<CreateBuyProposalOutput> {
    const { userId, conversationId, intent } = input;
    const now = this.clock.now();

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
    });

    // 5. Beneficiary lookup — must exist and belong to the user.
    const beneficiary = await this.beneficiaryService.getById(
      userId,
      beneficiaryId,
    );
    if (beneficiary === null) {
      throw new BeneficiaryNotFoundError(beneficiaryId);
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
   *   5. Beneficiary lookup:
   *      - must exist + belong to the user (BeneficiaryNotFoundError)
   *      - type must be crypto_address (BeneficiaryWrongTypeError)
   *      - address must pass AssetRegistry.validateAddress (domain guard)
   *   6. First-use cooling-off (IDN-08):
   *      - if beneficiary.firstUseLockedUntil > clock.now → BeneficiaryCoolingOffError
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
    const { userId, conversationId, intent, beneficiaryId } = input;
    const now = this.clock.now();

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
    // Fix-C: compute NGN equivalent using BigInt to avoid float drift.
    // baseRate is a whole-number NGN-per-USDT rate from config (e.g. 1600).
    // cryptoAmount × baseRate is computed as:
    //   scaledNgn = toScaled(cryptoAmount) × BigInt(baseRate) / SCALE
    // where SCALE = 10^18. This gives the NGN value scaled to 10^18 units,
    // then we convert back to a decimal string for the gate.
    const pricingConfig = this.configService.get<PricingConfig>('pricing');
    const baseFiat = this.assetRegistry.defaultFiat();
    // Fail closed on a missing / 0 / negative baseRate via the shared guard: a
    // zero rate would zero the fiat-equivalent and silently bypass the KYC /
    // velocity / Travel-Rule gate (§3.1 / §3.3). Same guard as ExecutionService.
    const baseRate = resolveBaseRate(pricingConfig, intent.asset, baseFiat);
    // Compute NGN equivalent: cryptoAmount × baseRate, BigInt-exact (Fix-C).
    // baseRate is an integer NGN-per-USDT rate from config (e.g. 1600).
    // toScaled(cryptoAmount) returns the 10^18-scaled representation of cryptoAmount.
    // Multiplying by baseRate (an integer) gives the result in units of
    //   10^18 × NGN/USDT × USDT = 10^18 × NGN
    // i.e. the NGN amount already scaled to 10^18, exactly as toScaled() outputs
    // for a regular NGN amount — so we can feed it directly to the gate via
    // fromScaled-equivalent string conversion.
    const LEDGER_SCALE = 10n ** 18n;
    const scaledCrypto = toScaled(intent.cryptoAmount);
    // Exact decimal multiplication: multiply both operands as 10^18-scaled bigints
    // then divide by SCALE once to stay in the 10^18 unit space.
    // This handles fractional baseRates (e.g. 1600.45) exactly — no Math.round.
    const scaledNgn18 =
      (scaledCrypto * toScaled(String(baseRate))) / LEDGER_SCALE;
    // Reconstruct decimal string from 10^18-scaled bigint (mirrors fromScaled in ledger.ts).
    const isNegNgn = scaledNgn18 < 0n;
    const absNgn = isNegNgn ? -scaledNgn18 : scaledNgn18;
    const wholeNgn = absNgn / LEDGER_SCALE;
    const fracNgn = absNgn % LEDGER_SCALE;
    const fracNgnStr =
      fracNgn === 0n
        ? ''
        : '.' + fracNgn.toString().padStart(18, '0').replace(/0+$/, '');
    const ngnEquivalentStr =
      (isNegNgn ? '-' : '') + wholeNgn.toString() + fracNgnStr;

    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: ngnEquivalentStr,
      fiatCurrency: baseFiat,
      asset: intent.asset,
    });

    // Keep a numeric form only for the Travel Rule threshold comparison and metadata
    // storage (those are approximate uses, not money-gate comparisons — Fix-C scope).
    const fiatValue = Number(intent.cryptoAmount) * baseRate;

    // 5. Beneficiary lookup — must exist, belong to user, and be a crypto_address.
    const beneficiary = await this.beneficiaryService.getById(
      userId,
      beneficiaryId,
    );
    if (beneficiary === null) {
      throw new BeneficiaryNotFoundError(beneficiaryId);
    }
    if (beneficiary.type !== 'crypto_address') {
      throw new BeneficiaryWrongTypeError(
        beneficiaryId,
        'crypto_address',
        beneficiary.type,
      );
    }
    // Address must still pass pattern validation (defensive re-check).
    const toAddress = beneficiary.cryptoAddress!;
    const addressValid = this.assetRegistry.validateAddress(
      intent.network,
      toAddress,
    );
    if (!addressValid) {
      throw new BeneficiaryWrongTypeError(
        beneficiaryId,
        'valid crypto_address',
        `invalid address: ${toAddress}`,
      );
    }

    // 6. First-use cooling-off (IDN-08).
    if (
      beneficiary.firstUseLockedUntil !== null &&
      beneficiary.firstUseLockedUntil > now
    ) {
      throw new BeneficiaryCoolingOffError(
        beneficiaryId,
        beneficiary.firstUseLockedUntil,
      );
    }

    // 7. Sanctions screening — screen BEFORE persisting; event always written.
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
      beneficiaryId,
      walletId: wallet.id,
      toAddress,
      requiresTravelRule,
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

    const beneficiaryLabel = beneficiary.label || undefined;

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
    // Use BigInt arithmetic to avoid float drift on the rate.
    const providerRateScaled = toScaled(swapQuote.rate);
    const SCALE = 10n ** 18n;
    const effectiveRateScaled =
      (providerRateScaled * toScaled(String(1 - spreadBps / 10_000))) / SCALE;
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
    // Use baseRate for the fromAsset.
    const pricingConfig = this.configService.get<PricingConfig>('pricing');
    const baseFiat = this.assetRegistry.defaultFiat();
    const baseRate = resolveBaseRate(pricingConfig, fromAsset, baseFiat);
    const LEDGER_SCALE = 10n ** 18n;
    const scaledFrom = toScaled(amount);
    const scaledNgn18 =
      (scaledFrom * toScaled(String(baseRate))) / LEDGER_SCALE;
    const isNegNgn = scaledNgn18 < 0n;
    const absNgn = isNegNgn ? -scaledNgn18 : scaledNgn18;
    const wholeNgn = absNgn / LEDGER_SCALE;
    const fracNgn = absNgn % LEDGER_SCALE;
    const fracNgnStr =
      fracNgn === 0n
        ? ''
        : '.' + fracNgn.toString().padStart(18, '0').replace(/0+$/, '');
    const ngnEquivalentStr =
      (isNegNgn ? '-' : '') + wholeNgn.toString() + fracNgnStr;

    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: ngnEquivalentStr,
      fiatCurrency: baseFiat,
      asset: fromAsset,
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
