/**
 * ExecutionService — the deterministic execution engine for buy orders.
 * (Task 4.5a, CLAUDE.md §3.1)
 *
 * THE MONEY-PATH HEART. This is the ONLY component that:
 *   1. Runs the full server-side validation gauntlet.
 *   2. Creates the Transaction row (the settled money movement record).
 *   3. Enqueues the SettlementOutbox entry for reliable async processing.
 *
 * Security invariants preserved:
 *   - §3.1: No LLM output moves money. Model only proposes; this engine executes.
 *   - §3.2: No DB credentials in this file. Only application-layer ports injected.
 *   - §3.3: KycGateService is called server-side, always, before any side-effect.
 *   - NFR-7: At-most-once via idempotency key lookup before any writes.
 *
 * Validation gauntlet (ORDER IS SECURITY-CRITICAL — fail closed at each step):
 *   1. Load Proposal — must exist, userId matches, status in {pending, confirmed}, not expired.
 *   2. Re-quote drift — |effectiveRate drift| > buy.maxDriftBps → QuoteDriftError.
 *   3. KYC gate — assertCanTransact (server-side, again).
 *   4. DirectiveService.consume — grant authorizes this exact proposal; ref must be request_pin.
 *   5. PinService.verifyPin — PIN correct and not locked.
 *   6. Idempotency — if Transaction found for key, return existing result (no new side effects).
 *   7. Atomic writes — create Transaction + mark Proposal executing (single DB transaction).
 *   8. Side effects — provision wallet, create Flutterwave collection, persist VA details,
 *      enqueue outbox.
 *   9. Return ExecuteBuyResult.
 */

import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { PinService } from '../../../core/auth/pin.service';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import { IdentityService } from '../../identity/application/identity.service';
import { QuotesService } from '../../quotes/application/quotes.service';
import { WalletService } from '../../wallets/application/wallet.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from '../../whatsapp/application/ports/whatsapp-sender.port';
import type {
  AppConfig,
  BuyConfig,
  SellConfig,
} from '../../../core/config/configuration';
import {
  PAYMENT_PROVIDER,
  type IPaymentProvider,
} from '../../treasury/application/ports/payment-provider.port';
import {
  PROPOSAL_REPOSITORY,
  type IProposalRepository,
} from './ports/proposal.repository.port';
import {
  QUOTE_REPOSITORY,
  type IQuoteRepository,
} from './ports/quote.repository.port';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
  type TransactionRecord,
} from './ports/transaction.repository.port';
import {
  SETTLEMENT_OUTBOX_REPOSITORY,
  type ISettlementOutboxRepository,
} from './ports/settlement-outbox.repository.port';
import {
  SETTLEMENT_REPOSITORY,
  type ISettlementRepository,
} from './ports/settlement.repository.port';
import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
} from './ports/ledger.repository.port';
import { DirectiveService } from './directive.service';
import {
  ProposalExpiredError,
  ProposalNotExecutableError,
  QuoteDriftError,
  SettlementInvalidStatusError,
  InsufficientBalanceError,
} from '../domain/execution-errors';
import { toScaled } from '../domain/ledger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteBuyInput {
  userId: string;
  proposalId: string;
  directiveId: string;
  nonce: string;
  pin: string;
  idempotencyKey: string;
}

export interface ExecuteBuyResult {
  transactionId: string;
  status: 'settling' | 'completed';
  payment: {
    accountNumber: string;
    bankName: string;
    providerRef: string;
    amount: string;
    currency: 'NGN';
  };
}

export interface SettleBuyInput {
  /** The idempotency key used at executeBuy (= tx_ref for payment provider). */
  reference: string;
}

export interface SettleBuyResult {
  transactionId: string;
  status: 'completed' | 'pending';
  /** Set only when status === 'completed'. */
  receiptNumber?: string;
  /**
   * The userId that owns this transaction.
   * Always set so callers (e.g. the Flutterwave webhook handler) can resolve
   * the user's notification address without an additional DB lookup.
   */
  userId?: string;
}

// ---------------------------------------------------------------------------
// Sell types
// ---------------------------------------------------------------------------

export interface ExecuteSellInput {
  userId: string;
  proposalId: string;
  directiveId: string;
  nonce: string;
  pin: string;
  idempotencyKey: string;
}

export interface ExecuteSellResult {
  transactionId: string;
  status: 'settling';
  payout: {
    /** Flutterwave transfer id. */
    providerRef: string;
  };
}

export interface SettleSellInput {
  /** The Flutterwave transfer reference (providerRef from createPayout). */
  reference: string;
}

export interface SettleSellResult {
  transactionId: string;
  status: 'completed' | 'failed' | 'pending';
  receiptNumber?: string;
  userId?: string;
}

// Statuses that allow the engine to execute against a proposal (I1: typed set).
const EXECUTABLE_STATUSES = new Set<string>(['pending', 'confirmed']);

// The directive ref that must authorize a buy or sell execution.
const REQUIRED_DIRECTIVE_REF = 'request_pin';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ExecutionService {
  private readonly maxBuyDriftBps: number;
  private readonly maxSellDriftBps: number;
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    @Inject(PROPOSAL_REPOSITORY)
    private readonly proposalRepo: IProposalRepository,
    @Inject(QUOTE_REPOSITORY)
    private readonly quoteRepo: IQuoteRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactionRepo: ITransactionRepository,
    @Inject(SETTLEMENT_OUTBOX_REPOSITORY)
    private readonly outboxRepo: ISettlementOutboxRepository,
    @Inject(SETTLEMENT_REPOSITORY)
    private readonly settlementRepo: ISettlementRepository,
    private readonly quotesService: QuotesService,
    private readonly kycGate: KycGateService,
    private readonly directiveService: DirectiveService,
    private readonly pinService: PinService,
    private readonly walletService: WalletService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: IPaymentProvider,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(CLOCK)
    private readonly clock: Clock,
    private readonly assetRegistry: AssetRegistry,
    private readonly beneficiaryService: BeneficiaryService,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledgerRepo: ILedgerRepository,
    @Optional()
    private readonly identityService?: IdentityService,
    @Optional()
    @Inject(WHATSAPP_SENDER)
    private readonly whatsAppSender?: IWhatsAppSender,
  ) {
    const buyConfig = this.config.get<BuyConfig>('buy');
    this.maxBuyDriftBps = buyConfig.maxDriftBps;
    const sellConfig = this.config.get<SellConfig>('sell');
    this.maxSellDriftBps = sellConfig.maxDriftBps;
  }

  /**
   * Executes a buy order after running the full server-side validation gauntlet.
   *
   * Returns an ExecuteBuyResult containing the virtual account the user must
   * pay into. Settlement (crediting USDT after payment) is handled in Task 4.5b.
   */
  async executeBuy(input: ExecuteBuyInput): Promise<ExecuteBuyResult> {
    const { userId, proposalId, directiveId, nonce, pin, idempotencyKey } =
      input;
    const now = this.clock.now();

    // ── Step 1: Load and validate proposal ──────────────────────────────────
    const proposal = await this.proposalRepo.findById(proposalId);

    if (proposal === null) {
      throw new ProposalNotExecutableError('not found');
    }
    if (proposal.userId !== userId) {
      throw new ProposalNotExecutableError('userId mismatch');
    }
    if (!EXECUTABLE_STATUSES.has(proposal.status)) {
      throw new ProposalNotExecutableError(
        `status '${proposal.status}' is not executable`,
      );
    }
    if (proposal.expiresAt <= now) {
      throw new ProposalExpiredError();
    }

    // ── Step 2: Re-quote drift check ─────────────────────────────────────────
    // Load the original quote snapshot for drift calculation.
    const quoteId = proposal.quoteId;
    if (quoteId === null) {
      throw new ProposalNotExecutableError('proposal has no associated quote');
    }
    const storedQuote = await this.quoteRepo.findById(quoteId);
    if (storedQuote === null) {
      throw new ProposalNotExecutableError('associated quote not found');
    }

    // Re-quote to get a fresh effective rate.
    const freshQuote = await this.quotesService.quoteBuy({
      asset: storedQuote.asset as 'USDT' | 'BTC',
      fiatAmount: storedQuote.fiatAmount,
      fiatCurrency: storedQuote.fiatCurrency as 'NGN',
    });

    const storedRate = Number(storedQuote.fxRate);
    const freshRate = Number(freshQuote.fxRate);

    // Drift in basis points = |ΔRate / storedRate| × 10000
    const driftBps =
      storedRate > 0
        ? (Math.abs(freshRate - storedRate) / storedRate) * 10_000
        : 0;

    if (driftBps > this.maxBuyDriftBps) {
      throw new QuoteDriftError(driftBps, this.maxBuyDriftBps);
    }

    // ── Step 3: KYC gate (server-side, always) ──────────────────────────────
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: Number(storedQuote.fiatAmount),
      asset: storedQuote.asset,
    });

    // ── Step 4: Consume directive grant (authorizes this exact proposal) ─────
    // Throws DirectiveReplayError, DirectiveExpiredError, DirectiveSignatureError,
    // DirectiveProposalMismatchError on any failure — let them propagate.
    const grant = await this.directiveService.consume({
      directiveId,
      nonce,
      proposalId,
    });

    // The grant must be a request_pin directive — reject any other ref.
    if (grant.directiveRef !== REQUIRED_DIRECTIVE_REF) {
      throw new ProposalNotExecutableError(
        `directive ref '${grant.directiveRef}' is not '${REQUIRED_DIRECTIVE_REF}'`,
      );
    }

    // ── Step 5: Verify PIN ───────────────────────────────────────────────────
    // TODO(SEC): wire session step-up (Session.stepUpCompletedAt) — deferred.
    // PIN + the consumed signed directive are the authorizers for now.
    await this.pinService.verifyPin(userId, pin);

    // ── Step 6: Idempotency check ────────────────────────────────────────────
    // Check AFTER auth so we don't reveal idempotent results to unauthenticated callers.
    const existing =
      await this.transactionRepo.findByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      // Replay — return the previous result without re-running side effects.
      return this.buildResultFromTransaction(existing, storedQuote.fiatAmount);
    }

    // ── Step 7: Atomic writes — create Transaction + mark Proposal executing ─
    // Both writes run in a single Prisma $transaction so a failure between them
    // cannot orphan a settling Transaction while the Proposal stays pending (C1).
    const requestChecksum = this.buildRequestChecksum({
      userId,
      proposalId,
      asset: storedQuote.asset,
      fiatAmount: storedQuote.fiatAmount,
      fxRate: storedQuote.fxRate,
    });

    const txn = await this.transactionRepo.createSettlingWithProposal({
      txnData: {
        proposalId,
        userId,
        type: 'buy',
        status: 'settling',
        idempotencyKey,
        requestChecksum,
        fxRateSnapshot: storedQuote.fxRate,
        metadata: {
          asset: storedQuote.asset,
          fiatAmount: storedQuote.fiatAmount,
          fiatCurrency: storedQuote.fiatCurrency,
          // Within-tolerance drift: re-use the stored crypto amount (conservative; phase A).
          cryptoAmount: storedQuote.cryptoAmount,
          fxRate: storedQuote.fxRate,
          baseRate: storedQuote.baseRate,
          spreadBps: storedQuote.spreadBps,
          processingFeeBps: storedQuote.processingFeeBps,
          processingFeeAmount: storedQuote.processingFeeAmount,
        },
        pinVerifiedAt: now,
      },
      proposalId,
      confirmedAt: now,
      // V1 — §3.3 gap fix: write velocity counters atomically so the daily gate
      // sees in-flight usage on the next call. Uses the Clock's `now` (not
      // Date.now()) so the window boundary is deterministic in tests.
      velocityIncrement: {
        userId,
        fiatAmountStr: storedQuote.fiatAmount,
        now,
      },
    });

    // ── Step 8: Side effects ─────────────────────────────────────────────────
    // These call external sandboxes through ports — never touch the DB directly.

    // 8a. Provision / retrieve the user's custodial wallet for the buy asset.
    // Idempotent: returns the existing wallet if already provisioned.
    // Asset is sourced from the stored quote; network from the registry default
    // for that asset — catalog is the single source of truth (task X3).
    const buyAsset = storedQuote.asset;
    const buyNetwork = this.assetRegistry.defaultNetworkFor(buyAsset);
    await this.walletService.getOrProvisionWallet(userId, buyAsset, buyNetwork);

    // 8b. Open a Flutterwave NGN virtual-account collection.
    // Customer details: sourced from user KYC if available; safe fallbacks used
    // for optional fields (KYC names may be null — noted, not blocking).
    // TODO: when KycProfile is queryable from the engine, use real firstname/lastname.
    const collection = await this.paymentProvider.createCollection({
      amount: storedQuote.fiatAmount,
      currency: 'NGN',
      reference: idempotencyKey,
      customer: {
        // Safe fallback: use a synthetic email derived from userId.
        // Real email will come from User.verifiedEmail in a future iteration.
        email: `user+${userId}@handshake.internal`,
        firstname: 'Handshake',
        lastname: 'User',
      },
    });

    // 8c. Persist VA details into Transaction metadata so idempotent replay
    // can return the real VA without calling the provider again (C2).
    await this.transactionRepo.mergeMetadata(txn.id, {
      accountNumber: collection.accountNumber,
      bankName: collection.bankName,
      providerRef: collection.providerRef,
    });

    // 8d. Enqueue the SettlementOutbox entry for reliable async processing.
    await this.outboxRepo.create({
      transactionId: txn.id,
      settlementType: 'processor_collection',
      payload: {
        reference: idempotencyKey,
        amount: storedQuote.fiatAmount,
        providerRef: collection.providerRef,
        accountNumber: collection.accountNumber,
        bankName: collection.bankName,
      },
      idempotencyKey,
      status: 'pending',
      processorRef: collection.providerRef,
    });

    // ── Step 9: Return result ────────────────────────────────────────────────
    return {
      transactionId: txn.id,
      status: 'settling',
      payment: {
        accountNumber: collection.accountNumber,
        bankName: collection.bankName,
        providerRef: collection.providerRef,
        amount: storedQuote.fiatAmount,
        currency: 'NGN',
      },
    };
  }

  /**
   * Phase B of a buy: verifies the NGN collection then atomically settles it.
   *
   * Flow (§3.1 preserved — model proposes, engine disposes):
   *   1. Load Transaction by idempotency key (reference).
   *   2. Idempotent path: already completed → return existing receipt, no re-credit.
   *   3. Guard: status must be 'settling'; anything else is an error.
   *   4. Verify payment with PAYMENT_PROVIDER.
   *      - Not successful → return pending (do NOT credit).
   *      - Amount or currency mismatch → return pending.
   *   5. Resolve the user's USDT wallet (idempotent provision).
   *   6. Delegate the atomic multi-step write to SettlementRepository.settleBuyAtomic
   *      (single $transaction; rolls back on any failure).
   *   7. Return { transactionId, status:'completed', receiptNumber }.
   */
  async settleBuyPayment(input: SettleBuyInput): Promise<SettleBuyResult> {
    const { reference } = input;

    // ── Step 1: Load Transaction by idempotency key ──────────────────────────
    const txn = await this.transactionRepo.findByIdempotencyKey(reference);
    if (txn === null) {
      throw new ProposalNotExecutableError(
        `no transaction found for reference '${reference}'`,
      );
    }

    // ── Step 2: Idempotent path — already completed ─────────────────────────
    if (txn.status === 'completed') {
      const receiptNumber = await this.settlementRepo.findReceiptNumber(txn.id);
      return {
        transactionId: txn.id,
        status: 'completed',
        userId: txn.userId,
        ...(receiptNumber !== null ? { receiptNumber } : {}),
      };
    }

    // ── Step 3: Guard — must be 'settling' ───────────────────────────────────
    if (txn.status !== 'settling') {
      throw new SettlementInvalidStatusError(txn.status);
    }

    // ── Step 4: Verify payment with provider ─────────────────────────────────
    const verifyResult = await this.paymentProvider.verify(reference);

    if (verifyResult.status !== 'successful') {
      // Payment not yet confirmed — leave the Transaction in 'settling'.
      return { transactionId: txn.id, status: 'pending', userId: txn.userId };
    }

    // Validate amount (decimal-safe: compare as BigInt-scaled integers).
    const meta = txn.metadata as Record<string, string>;
    const expectedFiatAmount = meta.fiatAmount ?? '0';

    // Scale and compare to avoid float drift.
    const SCALE = 10n ** 18n;
    const toScaled = (s: string): bigint => {
      const [whole = '0', frac = ''] = s.trim().split('.');
      const fracPadded = frac.slice(0, 18).padEnd(18, '0');
      return BigInt(whole) * SCALE + BigInt(fracPadded);
    };

    const verifiedAmount = toScaled(verifyResult.amount);
    const expectedAmount = toScaled(expectedFiatAmount);

    if (verifiedAmount < expectedAmount || verifyResult.currency !== 'NGN') {
      // Mismatch — leave in settling; operator/webhook will retry.
      return { transactionId: txn.id, status: 'pending', userId: txn.userId };
    }

    // ── Step 5: Resolve the user's USDT wallet ────────────────────────────────
    // Asset is sourced from the transaction metadata; network from the registry
    // default for that asset — catalog is the single source of truth (task X3).
    // Fallback to defaultCryptoAsset() covers older transactions written before
    // the asset field was added to metadata; remove once all txns carry meta.asset.
    const settleAsset =
      (meta.asset as string | undefined) ??
      this.assetRegistry.defaultCryptoAsset();
    const settleNetwork = this.assetRegistry.defaultNetworkFor(settleAsset);
    const wallet = await this.walletService.getOrProvisionWallet(
      txn.userId,
      settleAsset,
      settleNetwork,
    );

    // ── Step 6: Atomic settlement ─────────────────────────────────────────────
    const now = this.clock.now();
    const year = now.getFullYear().toString();

    const { receiptNumber } = await this.settlementRepo.settleBuyAtomic({
      transactionId: txn.id,
      userId: txn.userId,
      walletId: wallet.id,
      fiatAmount: expectedFiatAmount,
      cryptoAmount: meta.cryptoAmount ?? '0',
      processingFee: meta.processingFeeAmount ?? '0',
      providerRef: verifyResult.providerRef,
      now,
      year,
    });

    // ── Step 7: Return result ─────────────────────────────────────────────────
    return {
      transactionId: txn.id,
      status: 'completed',
      userId: txn.userId,
      receiptNumber,
    };
  }

  // ---------------------------------------------------------------------------
  // Sell execution (task S4b)
  // ---------------------------------------------------------------------------

  /**
   * Executes a sell order after running the full server-side validation gauntlet.
   *
   * TWO-PHASE SELL:
   *   Phase 1 (this method): reserve USDT (user_wallet → clearing) to prevent
   *   double-spend while the NGN payout is in flight.  Transaction status = 'settling'.
   *   Phase 2 (settleSellPayout): on payout success, finalize (clearing → treasury +
   *   NGN leg); on failure, refund (clearing → user_wallet) + CompensationRecord.
   *
   * Validation gauntlet (ORDER IS SECURITY-CRITICAL):
   *   1. Load Proposal(sell, status pending|confirmed, owner, not expired).
   *   2. Re-quote drift check.
   *   3. KYC gate (server-side, always).
   *   4. Balance re-check via ledger (TOCTOU guard at execute time).
   *   5. DirectiveService.consume (ref must be request_pin).
   *   6. PinService.verifyPin.
   *   7. Idempotency check (after auth, before writes).
   *   8. Atomic write: Transaction(settling) + reserve ledger + Proposal→executing.
   *   9. Initiate Flutterwave payout + enqueue SettlementOutbox(processor_payout).
   */
  async executeSell(input: ExecuteSellInput): Promise<ExecuteSellResult> {
    const { userId, proposalId, directiveId, nonce, pin, idempotencyKey } =
      input;
    const now = this.clock.now();

    // ── Step 1: Load and validate proposal ──────────────────────────────────
    const proposal = await this.proposalRepo.findById(proposalId);

    if (proposal === null) {
      throw new ProposalNotExecutableError('not found');
    }
    if (proposal.userId !== userId) {
      throw new ProposalNotExecutableError('userId mismatch');
    }
    if (!EXECUTABLE_STATUSES.has(proposal.status)) {
      throw new ProposalNotExecutableError(
        `status '${proposal.status}' is not executable`,
      );
    }
    if (proposal.expiresAt <= now) {
      throw new ProposalExpiredError();
    }
    if (proposal.type !== 'sell') {
      throw new ProposalNotExecutableError(
        `proposal type '${proposal.type}' is not 'sell'`,
      );
    }

    // ── Step 2: Re-quote drift check ─────────────────────────────────────────
    const quoteId = proposal.quoteId;
    if (quoteId === null) {
      throw new ProposalNotExecutableError('proposal has no associated quote');
    }
    const storedQuote = await this.quoteRepo.findById(quoteId);
    if (storedQuote === null) {
      throw new ProposalNotExecutableError('associated quote not found');
    }

    // Re-quote to get a fresh effective rate.
    const freshQuote = await this.quotesService.quoteSell({
      asset: storedQuote.asset as 'USDT',
      cryptoAmount: storedQuote.cryptoAmount,
      fiatCurrency: storedQuote.fiatCurrency as 'NGN',
    });

    const storedRate = Number(storedQuote.fxRate);
    const freshRate = Number(freshQuote.fxRate);

    const driftBps =
      storedRate > 0
        ? (Math.abs(freshRate - storedRate) / storedRate) * 10_000
        : 0;

    if (driftBps > this.maxSellDriftBps) {
      throw new QuoteDriftError(driftBps, this.maxSellDriftBps);
    }

    // ── Step 3: KYC gate (server-side, always) ──────────────────────────────
    // Use netFiatAmount from stored quote as the fiat amount for the gate.
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: Number(storedQuote.fiatAmount),
      asset: storedQuote.asset,
    });

    // ── Step 4: Re-check balance via ledger (TOCTOU guard) ──────────────────
    // Resolve the wallet to look up its authoritative ledger balance.
    const sellAsset = storedQuote.asset;
    const sellNetwork = this.assetRegistry.defaultNetworkFor(sellAsset);
    const wallet = await this.walletService.getOrProvisionWallet(
      userId,
      sellAsset,
      sellNetwork,
    );

    const balance = await this.ledgerRepo.getAccountBalance(
      'user_wallet',
      wallet.id,
      sellAsset,
    );

    // Decimal-safe comparison using the same scale as the ledger domain.
    if (toScaled(balance) < toScaled(storedQuote.cryptoAmount)) {
      throw new InsufficientBalanceError(
        balance,
        storedQuote.cryptoAmount,
        sellAsset,
      );
    }

    // ── Step 5: Consume directive grant ──────────────────────────────────────
    const grant = await this.directiveService.consume({
      directiveId,
      nonce,
      proposalId,
    });

    if (grant.directiveRef !== REQUIRED_DIRECTIVE_REF) {
      throw new ProposalNotExecutableError(
        `directive ref '${grant.directiveRef}' is not '${REQUIRED_DIRECTIVE_REF}'`,
      );
    }

    // ── Step 6: Verify PIN ───────────────────────────────────────────────────
    await this.pinService.verifyPin(userId, pin);

    // ── Step 7: Idempotency check ────────────────────────────────────────────
    const existing =
      await this.transactionRepo.findByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      const meta = existing.metadata as Record<string, string>;
      return {
        transactionId: existing.id,
        status: 'settling',
        payout: {
          providerRef: meta.providerRef ?? existing.processorTxRef ?? '',
        },
      };
    }

    // ── Step 8: Read beneficiary bank account for payout ────────────────────
    const meta = proposal.parameters as Record<string, string>;
    const beneficiaryId = meta.beneficiaryId;
    if (!beneficiaryId) {
      throw new ProposalNotExecutableError(
        'proposal parameters missing beneficiaryId',
      );
    }

    const beneficiary = await this.beneficiaryService.getById(
      userId,
      beneficiaryId,
    );
    if (beneficiary === null) {
      throw new ProposalNotExecutableError(
        `beneficiary '${beneficiaryId}' not found`,
      );
    }
    if (beneficiary.type !== 'bank_account') {
      throw new ProposalNotExecutableError(
        `beneficiary type '${beneficiary.type}' must be 'bank_account' for a sell payout`,
      );
    }
    if (
      !beneficiary.accountNumber ||
      !beneficiary.bankCode ||
      !beneficiary.accountHolderName
    ) {
      throw new ProposalNotExecutableError(
        'beneficiary bank account details incomplete (accountNumber, bankCode, accountHolderName required)',
      );
    }

    // ── Step 9: Atomic write ─────────────────────────────────────────────────
    // create Transaction(sell, settling) + reserve USDT (user_wallet→clearing)
    // + mark Proposal→executing — all in a SINGLE DB $transaction (C1).
    //
    // NOTE: We use settlementRepo.createSellSettlingWithReserveAtomic instead of
    // the prior two-call pattern (transactionRepo.createSettlingWithProposal +
    // settlementRepo.postSellReserveAtomic). The two separate $transactions had a
    // double-spend window: if the process died between them, idempotency would
    // return 'settling' on retry without ever debiting the user_wallet.
    const requestChecksum = this.buildRequestChecksum({
      userId,
      proposalId,
      asset: storedQuote.asset,
      fiatAmount: storedQuote.fiatAmount,
      fxRate: storedQuote.fxRate,
    });

    const { txn } =
      await this.settlementRepo.createSellSettlingWithReserveAtomic({
        txnData: {
          proposalId,
          userId,
          type: 'sell',
          status: 'settling',
          idempotencyKey,
          requestChecksum,
          fxRateSnapshot: storedQuote.fxRate,
          metadata: {
            asset: storedQuote.asset,
            cryptoAmount: storedQuote.cryptoAmount,
            netFiatAmount: storedQuote.fiatAmount,
            beneficiaryId,
            walletId: wallet.id,
          },
          pinVerifiedAt: now,
        },
        proposalId,
        confirmedAt: now,
        velocityIncrement: {
          userId,
          fiatAmountStr: storedQuote.fiatAmount,
          now,
        },
        walletId: wallet.id,
        cryptoAmount: storedQuote.cryptoAmount,
        now,
      });

    // ── Step 10: Initiate NGN payout ─────────────────────────────────────────
    const payout = await this.paymentProvider.createPayout({
      amount: storedQuote.fiatAmount,
      currency: 'NGN',
      reference: idempotencyKey,
      bankAccount: {
        // These are guaranteed non-null by the guard in step 8 of the gauntlet.

        accountNumber: beneficiary.accountNumber,

        bankCode: beneficiary.bankCode,

        accountName: beneficiary.accountHolderName,
      },
    });

    // Persist providerRef into Transaction metadata for idempotent replay.
    await this.transactionRepo.mergeMetadata(txn.id, {
      providerRef: payout.providerRef,
    });

    // ── Step 11: Enqueue SettlementOutbox ────────────────────────────────────
    await this.outboxRepo.create({
      transactionId: txn.id,
      settlementType: 'processor_payout',
      payload: {
        reference: idempotencyKey,
        amount: storedQuote.fiatAmount,
        providerRef: payout.providerRef,
        beneficiaryId,
      },
      idempotencyKey,
      status: 'pending',
      processorRef: payout.providerRef,
    });

    return {
      transactionId: txn.id,
      status: 'settling',
      payout: { providerRef: payout.providerRef },
    };
  }

  /**
   * Phase 2 of a sell: verifies the NGN payout then atomically settles or refunds.
   *
   * Flow (§3.1 preserved — model proposes, engine disposes):
   *   1. Load Transaction by idempotencyKey (= reference passed to createPayout).
   *   2. Idempotent path: already completed → return existing receipt.
   *   3. Guard: status must be 'settling'.
   *   4. Verify payout with PAYMENT_PROVIDER.verifyPayout(reference).
   *      - Pending → return pending.
   *      - Successful → settleSellFinalizeAtomic.
   *      - Failed → settleSellRefundAtomic + return failed.
   *   5. Send WhatsApp notification (swallowed — never breaks settlement).
   */
  async settleSellPayout(input: SettleSellInput): Promise<SettleSellResult> {
    const { reference } = input;

    // ── Step 1: Load Transaction by idempotencyKey ───────────────────────────
    const txn = await this.transactionRepo.findByIdempotencyKey(reference);
    if (txn === null) {
      throw new ProposalNotExecutableError(
        `no transaction found for reference '${reference}'`,
      );
    }

    // ── Step 2: Idempotent path ──────────────────────────────────────────────
    if (txn.status === 'completed') {
      const receiptNumber = await this.settlementRepo.findReceiptNumber(txn.id);
      return {
        transactionId: txn.id,
        status: 'completed',
        userId: txn.userId,
        ...(receiptNumber !== null ? { receiptNumber } : {}),
      };
    }

    // ── Step 3: Guard ─────────────────────────────────────────────────────────
    if (txn.status !== 'settling') {
      throw new SettlementInvalidStatusError(txn.status);
    }

    // ── Step 4: Verify payout ─────────────────────────────────────────────────
    const meta = txn.metadata as Record<string, string>;
    const providerRef = meta.providerRef ?? '';

    const verifyResult = await this.paymentProvider.verifyPayout(providerRef);

    if (verifyResult.status === 'pending') {
      return { transactionId: txn.id, status: 'pending', userId: txn.userId };
    }

    const walletId = meta.walletId ?? '';
    const cryptoAmount = meta.cryptoAmount ?? '0';
    const netFiatAmount = meta.netFiatAmount ?? '0';
    const now = this.clock.now();
    const year = now.getFullYear().toString();

    if (verifyResult.status === 'successful') {
      // ── Step 5a: Finalize ───────────────────────────────────────────────────
      const { receiptNumber } =
        await this.settlementRepo.settleSellFinalizeAtomic({
          transactionId: txn.id,
          userId: txn.userId,
          walletId,
          cryptoAmount,
          netFiatAmount,
          providerRef: verifyResult.providerRef,
          now,
          year,
        });

      // ── Step 6a: Notify (success) — errors are swallowed, never break settlement.
      await this.notifySellComplete({
        userId: txn.userId,
        receiptNumber,
        cryptoAmount,
        netFiatAmount,
      });

      return {
        transactionId: txn.id,
        status: 'completed',
        userId: txn.userId,
        receiptNumber,
      };
    }

    // ── Step 5b: Failure → refund + compensation ──────────────────────────────
    await this.settlementRepo.settleSellRefundAtomic({
      transactionId: txn.id,
      userId: txn.userId,
      walletId,
      cryptoAmount,
      failureReason: `payout verifyPayout returned status '${verifyResult.status}'`,
      now,
    });

    // ── Step 6b: Notify (failure) — errors are swallowed, never break settlement.
    await this.notifySellFailed({
      userId: txn.userId,
      cryptoAmount,
    });

    return {
      transactionId: txn.id,
      status: 'failed',
      userId: txn.userId,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Sends a sell-complete WhatsApp receipt to the user.
   *
   * Errors are swallowed and logged — notification failure must NEVER break
   * settlement (settlement has already committed; the user's bank payout is done).
   */
  private async notifySellComplete(params: {
    userId: string;
    receiptNumber: string;
    cryptoAmount: string;
    netFiatAmount: string;
  }): Promise<void> {
    try {
      if (
        this.identityService === undefined ||
        this.whatsAppSender === undefined
      ) {
        return;
      }
      const waAddress = await this.identityService.findWhatsAppAddress(
        params.userId,
      );
      if (waAddress === null) {
        return;
      }
      const formattedCrypto = this.assetRegistry.formatCrypto(
        params.cryptoAmount,
        'USDT',
      );
      const formattedFiat = this.assetRegistry.formatFiat(
        params.netFiatAmount,
        'NGN',
      );
      const body =
        `✅ Your crypto sell is complete!\n` +
        `Receipt: ${params.receiptNumber}\n` +
        `You sold ${formattedCrypto} — ${formattedFiat} is on its way to your bank account.`;
      await this.whatsAppSender.sendText(waAddress, body);
    } catch (err: unknown) {
      // Notification errors must never propagate — settlement is already committed.
      this.logger.warn(
        { userId: params.userId, err },
        'notifySellComplete: failed to send WhatsApp receipt (swallowed)',
      );
    }
  }

  /**
   * Sends a sell-failed/refund WhatsApp notice to the user.
   *
   * Errors are swallowed and logged — notification failure must NEVER break
   * the refund flow (the refund ledger has already committed).
   */
  private async notifySellFailed(params: {
    userId: string;
    cryptoAmount: string;
  }): Promise<void> {
    try {
      if (
        this.identityService === undefined ||
        this.whatsAppSender === undefined
      ) {
        return;
      }
      const waAddress = await this.identityService.findWhatsAppAddress(
        params.userId,
      );
      if (waAddress === null) {
        return;
      }
      const formattedCrypto = this.assetRegistry.formatCrypto(
        params.cryptoAmount,
        'USDT',
      );
      const body =
        `⚠️ Sell payout failed\n` +
        `Your ${formattedCrypto} has been refunded to your Handshake wallet.`;
      await this.whatsAppSender.sendText(waAddress, body);
    } catch (err: unknown) {
      this.logger.warn(
        { userId: params.userId, err },
        'notifySellFailed: failed to send WhatsApp notice (swallowed)',
      );
    }
  }

  /**
   * Builds the SHA-256 request checksum over the canonical parameter set.
   * This ensures distinct-param dedup even if two requests share an idempotency
   * key by mistake (different params = different checksum).
   */
  private buildRequestChecksum(params: {
    userId: string;
    proposalId: string;
    asset: string;
    fiatAmount: string;
    fxRate: string;
  }): string {
    // Canonical JSON (sorted keys) for deterministic hashing.
    const canonical = JSON.stringify({
      asset: params.asset,
      fiatAmount: params.fiatAmount,
      fxRate: params.fxRate,
      proposalId: params.proposalId,
      userId: params.userId,
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Reconstructs an ExecuteBuyResult from an existing Transaction row.
   * Used for idempotent replay (Step 6) — returns previous result without
   * calling any side-effecting port.
   *
   * VA details (accountNumber, bankName, providerRef) are read from
   * Transaction.metadata where they were persisted after createCollection (C2).
   */
  private buildResultFromTransaction(
    txn: TransactionRecord,
    fiatAmount: string,
  ): ExecuteBuyResult {
    const meta = txn.metadata as Record<string, string>;
    return {
      transactionId: txn.id,
      // Safely narrow to the expected union; falling back to 'settling' for
      // any non-terminal status (completed is the only other terminal success).
      status: txn.status === 'completed' ? 'completed' : 'settling',
      payment: {
        // VA details were persisted into metadata after first createCollection (C2).
        // processorTxRef is a fallback for legacy rows that pre-date the merge.
        accountNumber: meta.accountNumber ?? '',
        bankName: meta.bankName ?? '',
        providerRef: meta.providerRef ?? txn.processorTxRef ?? '',
        amount: fiatAmount,
        currency: 'NGN',
      },
    };
  }
}
