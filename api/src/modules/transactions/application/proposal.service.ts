import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
  BuyCryptoIntent,
  SellCryptoIntent,
} from '@handshake-agent/contracts';
import {
  BuyProposalConfirmationSchema,
  SellProposalConfirmationSchema,
} from '@handshake-agent/contracts';
import type {
  BuyProposalConfirmation,
  SellProposalConfirmation,
} from '@handshake-agent/contracts';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import { QuotesService } from '../../quotes/application/quotes.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { WalletService } from '../../wallets/application/wallet.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { InsufficientBalanceError } from '../domain/execution-errors';
import { BeneficiaryNotFoundError } from '../../beneficiaries/domain/beneficiary-errors';
import type { IProposalRepository } from './ports/proposal.repository.port';
import { PROPOSAL_REPOSITORY } from './ports/proposal.repository.port';
import type { IQuoteRepository } from './ports/quote.repository.port';
import { QUOTE_REPOSITORY } from './ports/quote.repository.port';
import type { ILedgerRepository } from './ports/ledger.repository.port';
import { LEDGER_REPOSITORY } from './ports/ledger.repository.port';

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
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: Number(intent.fiatAmount),
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
   *   1. Resolve the user's USDT/TRON wallet (getOrProvisionWallet).
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

    // 1. Resolve the user's USDT/TRON wallet.
    const network = this.assetRegistry.defaultNetworkFor(intent.asset);
    const wallet = await this.walletService.getOrProvisionWallet(
      userId,
      intent.asset,
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

    // Decimal-safe compare using BigInt at 18 decimal places.
    const toScaled = (s: string): bigint => {
      const str = s.trim();
      const isNeg = str.startsWith('-');
      const abs = isNeg ? str.slice(1) : str;
      const [whole = '0', frac = ''] = abs.split('.');
      const fracPadded = frac.slice(0, 18).padEnd(18, '0');
      const scaled = BigInt(whole) * 10n ** 18n + BigInt(fracPadded);
      return isNeg ? -scaled : scaled;
    };

    if (toScaled(balance) < toScaled(intent.cryptoAmount)) {
      throw new InsufficientBalanceError(
        balance,
        intent.cryptoAmount,
        intent.asset,
      );
    }

    // 4. KYC / velocity gate on the NGN out amount (§3.3) — BEFORE persisting.
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: Number(quote.netFiatAmount),
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
}
