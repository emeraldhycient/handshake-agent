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

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { PinService } from '../../../core/auth/pin.service';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import { QuotesService } from '../../quotes/application/quotes.service';
import { WalletService } from '../../wallets/application/wallet.service';
import type { AppConfig, BuyConfig } from '../../../core/config/configuration';
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
import { DirectiveService } from './directive.service';
import {
  ProposalExpiredError,
  ProposalNotExecutableError,
  QuoteDriftError,
  SettlementInvalidStatusError,
} from '../domain/execution-errors';

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

// Statuses that allow the engine to execute against a proposal (I1: typed set).
const EXECUTABLE_STATUSES = new Set<string>(['pending', 'confirmed']);

// The directive ref that must authorize a buy execution.
const REQUIRED_DIRECTIVE_REF = 'request_pin';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ExecutionService {
  private readonly maxDriftBps: number;

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
  ) {
    const buyConfig = this.config.get<BuyConfig>('buy');
    this.maxDriftBps = buyConfig.maxDriftBps;
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

    if (driftBps > this.maxDriftBps) {
      throw new QuoteDriftError(driftBps, this.maxDriftBps);
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
    });

    // ── Step 8: Side effects ─────────────────────────────────────────────────
    // These call external sandboxes through ports — never touch the DB directly.

    // 8a. Provision / retrieve the user's USDT-on-TRON custodial wallet.
    // Idempotent: returns the existing wallet if already provisioned.
    await this.walletService.getOrProvisionUsdtTronWallet(userId);

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
    const wallet = await this.walletService.getOrProvisionUsdtTronWallet(
      txn.userId,
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
  // Private helpers
  // ---------------------------------------------------------------------------

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
