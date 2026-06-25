import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BuyCryptoIntent,
  SellCryptoIntent,
  SendCryptoIntent,
} from '@handshake-agent/contracts';
import {
  BuyProposalConfirmationSchema,
  SellProposalConfirmationSchema,
  SendProposalConfirmationSchema,
} from '@handshake-agent/contracts';
import type {
  BuyProposalConfirmation,
  SellProposalConfirmation,
  SendProposalConfirmation,
} from '@handshake-agent/contracts';

import type {
  PricingConfig,
  ComplianceConfig,
} from '../../../core/config/configuration';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import { QuotesService } from '../../quotes/application/quotes.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { WalletService } from '../../wallets/application/wallet.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { InsufficientBalanceError } from '../domain/execution-errors';
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
import { toScaled } from '../domain/ledger';

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
    private readonly configService: ConfigService,
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
   *      - if NGN value ≥ compliance.travelRuleThresholdNgn → requiresTravelRule = true
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
    // TODO(WN): use AssetRegistry.defaultFiat() once Task 9 lands
    const baseRate = pricingConfig?.assets?.[intent.asset]?.baseRates?.['NGN'];
    if (baseRate === undefined) {
      throw new Error(
        `ProposalService: missing pricing.assets.${intent.asset}.baseRates.NGN in config — cannot compute NGN value for KYC gate.`,
      );
    }
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
      // TODO(WN): AssetRegistry.defaultFiat() (Task 9)
      fiatCurrency: 'NGN',
      asset: intent.asset,
    });

    // Keep a numeric form only for the Travel Rule threshold comparison and metadata
    // storage (those are approximate uses, not money-gate comparisons — Fix-C scope).
    const ngnValue = Number(intent.cryptoAmount) * baseRate;

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

    // 8. Travel-Rule flag — if NGN-equivalent ≥ configured threshold, flag it.
    const complianceConfig =
      this.configService.get<ComplianceConfig>('compliance');
    const travelRuleThreshold = complianceConfig?.travelRuleThresholdNgn;
    if (travelRuleThreshold === undefined) {
      throw new Error(
        'ProposalService: missing compliance.travelRuleThresholdNgn in config — cannot evaluate Travel Rule requirement.',
      );
    }
    const requiresTravelRule = ngnValue >= travelRuleThreshold;

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
}
