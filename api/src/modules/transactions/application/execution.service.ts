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

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { FiatCurrency } from '@handshake-agent/contracts';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { PinService } from '../../../core/auth/pin.service';
import { SessionService } from '../../../core/auth/session.service';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import { IdentityService } from '../../identity/application/identity.service';
import { QuotesService } from '../../quotes/application/quotes.service';
import { WalletService } from '../../wallets/application/wallet.service';
import type { WithdrawOutput } from '../../wallets/application/ports/wallet-provider.port';
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
  SwapConfig,
  PricingConfig,
} from '../../../core/config/configuration';
import {
  SWAP_PROVIDER,
  type ISwapProvider,
  type ExecuteSwapOutput,
} from '../../wallets/application/ports/swap-provider.port';
import { BeneficiaryCoolingOffError } from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';
import { ComplianceService } from '../../compliance/application/compliance.service';
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
  type VelocityReversal,
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
  ProviderUnavailableError,
  SwapUnavailableError,
} from '../domain/execution-errors';
import { toScaled } from '../domain/ledger';
import { resolveBaseRate } from './resolve-base-rate';

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
    currency: string;
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

// ---------------------------------------------------------------------------
// Send types
// ---------------------------------------------------------------------------

export interface ExecuteSendInput {
  userId: string;
  proposalId: string;
  directiveId: string;
  nonce: string;
  pin: string;
  idempotencyKey: string;
  /**
   * The device ID to bind this step-up to.
   * When omitted, executeSend resolves it from User.pinnedDeviceId via
   * SessionService. If neither is resolvable, the send is rejected (fail-closed
   * — §3.4: identity is anchored to bound device, not the phone number alone).
   */
  deviceId?: string;
}

export interface ExecuteSendResult {
  transactionId: string;
  status: 'settling';
  onChain: {
    providerRef: string;
  };
}

export interface SettleSendOnChainInput {
  /** The idempotency key used at executeSend (= providerRef for wallet provider). */
  reference: string;
  /** true = finalize (on-chain success), false = refund (on-chain failure). */
  success: boolean;
  /** On-chain tx hash — required when success=true. */
  onChainTxHash?: string;
}

export interface SettleSendOnChainResult {
  transactionId: string;
  status: 'completed' | 'failed' | 'pending';
  receiptNumber?: string;
  userId?: string;
}

/**
 * Output of `querySendWithdrawalStatus` — used by the reconciler to determine
 * whether to finalize, refund, or leave a pending onchain_send outbox row open.
 */
export interface QuerySendWithdrawalStatusOutput {
  /** Normalised provider status. */
  status: 'pending' | 'success' | 'failed';
  /** On-chain tx hash — present only when status = 'success'. */
  onChainTxHash?: string;
}

// ---------------------------------------------------------------------------
// Swap types
// ---------------------------------------------------------------------------

export interface ExecuteSwapServiceInput {
  userId: string;
  proposalId: string;
  directiveId: string;
  nonce: string;
  pin: string;
  idempotencyKey: string;
}

export interface ExecuteSwapResult {
  transactionId: string;
  status: 'settling';
  swap: {
    providerSwapId: string;
  };
}

export interface SettleSwapInput {
  /** The idempotency key used at executeSwap (= reference passed to SWAP_PROVIDER.execute). */
  reference: string;
  /** true = provider swap confirmed; false = provider swap failed. */
  success: boolean;
  /** Actual amount of toAsset received — required when success=true. */
  toAmount?: string;
  /** On-chain tx hash from the provider — may be present on success. */
  hash?: string;
}

export interface SettleSwapResult {
  transactionId: string;
  status: 'completed' | 'failed' | 'pending';
  receiptNumber?: string;
  userId?: string;
}

/**
 * Output of `querySwapStatus` — used by the reconciler to decide whether to
 * finalize, refund, or leave a pending `swap` outbox row open after a missed
 * Blockradar swap webhook.
 */
export interface QuerySwapStatusOutput {
  /** Normalised swap status. */
  status: 'pending' | 'success' | 'failed';
  /** Converted toAsset amount — present only on confirmed success. */
  toAmount?: string;
  /** On-chain tx hash — present only on confirmed success. */
  hash?: string;
}

// The directive ref required to authorize a send execution (step-up auth).
const REQUIRED_SEND_DIRECTIVE_REF = 'request_step_up';

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
  private readonly maxSwapDriftBps: number;
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
    // complianceService: NOT decorated with @Optional. NestJS DI will throw at
    // boot if ComplianceModule is not imported — fail-CLOSED posture (§3.3).
    // The type is ComplianceService | undefined only because TypeScript requires
    // that all optional positional params precede required ones; the runtime
    // guard in executeSend enforces the invariant explicitly.
    private readonly complianceService?: ComplianceService,
    // sessionService: records device-bound step-up after PIN passes (Fix G).
    // NOT @Optional — NestJS DI will throw at boot if AuthModule is not
    // imported. The runtime guard in executeSend enforces the invariant.
    private readonly sessionService?: SessionService,
    @Optional()
    @Inject(SWAP_PROVIDER)
    private readonly swapProvider?: ISwapProvider,
  ) {
    const buyConfig = this.config.get<BuyConfig>('buy');
    this.maxBuyDriftBps = buyConfig.maxDriftBps;
    const sellConfig = this.config.get<SellConfig>('sell');
    this.maxSellDriftBps = sellConfig.maxDriftBps;
    const swapConfig = this.config.get<SwapConfig>('swap');
    this.maxSwapDriftBps = swapConfig?.maxDriftBps ?? 50;
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
      fiatCurrency: storedQuote.fiatCurrency as FiatCurrency,
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
    // Fix-C: pass the exact decimal string — no Number() conversion at the gate.
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: storedQuote.fiatAmount,
      fiatCurrency: storedQuote.fiatCurrency,
      asset: storedQuote.asset,
    });

    // ── Step 4: Verify PIN (BEFORE consuming the one-shot directive) ─────────
    // I5: the directive is single-use. Consuming it before the PIN check means a
    // wrong-PIN typo permanently burns the grant and blocks a legitimate retry.
    // Verifying PIN first fails closed on a bad PIN WITHOUT spending the directive.
    // PIN has its own lockout, so this does not weaken brute-force resistance, and
    // every other invariant is preserved: the directive is still single-use
    // (consumed once, on the success path below), still expires, and is still
    // bound to this exact proposal.
    await this.pinService.verifyPin(userId, pin);

    // ── Step 5: Consume directive grant (authorizes this exact proposal) ─────
    // Still consumed before the idempotency check (step 6/7) so idempotent replay
    // applies to an in-process retry holding a valid directive, not a fresh
    // re-submit. Throws DirectiveReplayError, DirectiveExpiredError,
    // DirectiveSignatureError, DirectiveProposalMismatchError — let them propagate.
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
        fiatCurrency: storedQuote.fiatCurrency,
        fiatAmountStr: storedQuote.fiatAmount,
        now,
      },
    });

    // ── Step 8: Side effects ─────────────────────────────────────────────────
    // These call external sandboxes through ports — never touch the DB directly.

    // 8a. Provision / retrieve the user's (user, network) custodial wallet.
    // Idempotent: returns the existing wallet if already provisioned.
    // Asset is sourced from the stored quote; network from the registry default
    // for that asset — catalog is the single source of truth (task X3).
    // WN-1: wallet is per-(user,network); asset for ledger comes from the quote.
    const buyAsset = storedQuote.asset;
    const buyNetwork = this.assetRegistry.defaultNetworkFor(buyAsset);
    await this.walletService.getOrProvisionNetworkWallet(userId, buyNetwork);

    // 8b. Open a Flutterwave NGN virtual-account collection.
    // Customer details: sourced from user KYC if available; safe fallbacks used
    // for optional fields (KYC names may be null — noted, not blocking).
    // TODO: when KycProfile is queryable from the engine, use real firstname/lastname.
    // FUNDS-SAFETY (§3.1): the buy reserve (Step 7) posts NO ledger entry — the
    // user pays NGN later — so a createCollection failure means NO funds moved
    // and there is nothing to refund. But the settling Transaction + consumed
    // proposal/velocity are already committed; leaving it 'settling' with no VA
    // is a zombie buy the user can never pay for and the reconciler cannot act on
    // (no outbox row). Mark the Transaction failed on ANY createCollection
    // failure (4xx OR 5xx — no double-spend risk because nothing was debited) so
    // the idempotent-replay path does not return an empty payment block.
    let collection: Awaited<ReturnType<IPaymentProvider['createCollection']>>;
    try {
      collection = await this.callProvider('createCollection', () =>
        this.paymentProvider.createCollection({
          amount: storedQuote.fiatAmount,
          currency: storedQuote.fiatCurrency,
          reference: idempotencyKey,
          customer: {
            // Safe fallback: use a synthetic email derived from userId.
            // Real email will come from User.verifiedEmail in a future iteration.
            email: `user+${userId}@handshake.internal`,
            firstname: 'Handshake',
            lastname: 'User',
          },
        }),
      );
    } catch (err: unknown) {
      await this.transactionRepo.updateStatus(txn.id, 'failed', {
        failedAt: now,
        failureReason:
          'virtual-account creation failed at execute (no funds moved)',
      });
      throw err;
    }

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
        currency: storedQuote.fiatCurrency,
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

    // Validate amount (decimal-safe: compare as BigInt-scaled integers using
    // the imported toScaled from '../domain/ledger').
    const meta = txn.metadata as Record<string, string>;
    const expectedFiatAmount = meta.fiatAmount ?? '0';

    const verifiedAmount = toScaled(verifyResult.amount);
    const expectedAmount = toScaled(expectedFiatAmount);

    if (
      verifiedAmount < expectedAmount ||
      verifyResult.currency !== meta.fiatCurrency
    ) {
      // Mismatch — leave in settling; operator/webhook will retry.
      return { transactionId: txn.id, status: 'pending', userId: txn.userId };
    }

    // ── Step 5: Resolve the user's (user, network) wallet ────────────────────────────────
    // Asset is sourced from the transaction metadata; network from the registry
    // default for that asset — catalog is the single source of truth (task X3).
    // Fallback to defaultCryptoAsset() covers older transactions written before
    // the asset field was added to metadata; remove once all txns carry meta.asset.
    // WN-1: wallet is per-(user,network); asset for ledger credit comes from metadata.
    const settleAsset =
      (meta.asset as string | undefined) ??
      this.assetRegistry.defaultCryptoAsset();
    const settleNetwork = this.assetRegistry.defaultNetworkFor(settleAsset);
    const wallet = await this.walletService.getOrProvisionNetworkWallet(
      txn.userId,
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
      // WN-4: thread settleAsset so ledger legs key by asset, not a hardcoded literal.
      asset: settleAsset,
      // Task 5: fiatCurrency is always present in buy metadata (written at executeBuy).
      fiatCurrency: meta.fiatCurrency,
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
      fiatCurrency: storedQuote.fiatCurrency as FiatCurrency,
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
    // Fix-C: pass the exact decimal string — no Number() conversion at the gate.
    // storedQuote.fiatAmount for a sell quote holds the netFiatAmount (fiat out).
    await this.kycGate.assertCanTransact({
      userId,
      fiatAmount: storedQuote.fiatAmount,
      fiatCurrency: storedQuote.fiatCurrency,
      asset: storedQuote.asset,
    });

    // ── Step 4: Re-check balance via ledger (TOCTOU guard) ──────────────────
    // Resolve the (user, network) wallet for ledger balance lookup.
    // WN-1: wallet is per-(user,network); asset for balance query comes from quote.
    const sellAsset = storedQuote.asset;
    const sellNetwork = this.assetRegistry.defaultNetworkFor(sellAsset);
    const wallet = await this.walletService.getOrProvisionNetworkWallet(
      userId,
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

    // ── Step 5: Verify PIN (BEFORE consuming the one-shot directive) ─────────
    // I5: verify PIN first so a wrong-PIN typo does not burn the single-use
    // directive and block a legitimate retry. The directive stays single-use
    // (consumed once on success), still expires, and is still bound to this
    // proposal — only the wrong-PIN-spends-the-grant footgun is removed.
    await this.pinService.verifyPin(userId, pin);

    // ── Step 6: Consume directive grant ──────────────────────────────────────
    // Still consumed before the idempotency check (step 7/8) so idempotent replay
    // applies to an in-process retry holding a valid directive, not a fresh
    // re-submit.
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
            // Required by settleSellPayout → buildSellFinalizeEntries (reads
            // meta.fiatCurrency). The older createSettlingWithProposal path and
            // the buy path both persist it; this atomic path must too, or the
            // sell finalize crashes on `fiatCurrency.toLowerCase()`.
            fiatCurrency: storedQuote.fiatCurrency,
            // BUG 2 — persist the EXACT velocity contribution made at reserve so
            // a later refund (settleSellPayout failure path) can reverse it
            // byte-for-byte, even if config/rates drift between execute & settle.
            velocityFiatAmount: storedQuote.fiatAmount,
            velocityFiatCurrency: storedQuote.fiatCurrency,
            beneficiaryId,
            walletId: wallet.id,
            // providerRef is written atomically here because we pass idempotencyKey
            // as the reference to createPayout (step 10). If the process crashes
            // between the atomic write and the mergeMetadata call below,
            // settleSellPayout can still call verifyPayout(reference) directly
            // using the incoming webhook reference (= idempotencyKey) without
            // relying on meta.providerRef being populated.
            providerRef: idempotencyKey,
          },
          pinVerifiedAt: now,
        },
        proposalId,
        confirmedAt: now,
        velocityIncrement: {
          userId,
          fiatCurrency: storedQuote.fiatCurrency,
          fiatAmountStr: storedQuote.fiatAmount,
          now,
        },
        walletId: wallet.id,
        cryptoAmount: storedQuote.cryptoAmount,
        // WN-4: thread storedQuote.asset so ledger legs key by asset, not a hardcoded literal.
        asset: storedQuote.asset,
        now,
      });

    // ── Step 10: Initiate fiat payout ────────────────────────────────────────
    // Capture the guard-narrowed (non-null per step 8) bank details into a local
    // BEFORE the callProvider closure: a closure re-widens `beneficiary.*` back
    // to `string | null`, so the literal must be built in the narrowed scope.
    const payoutBankAccount = {
      accountNumber: beneficiary.accountNumber,
      bankCode: beneficiary.bankCode,
      accountName: beneficiary.accountHolderName,
    };

    // FUNDS-SAFETY (§3.1): the reserve (Step 9, user_wallet → clearing) is already
    // committed. If createPayout is DEFINITIVELY rejected by the provider (HTTP
    // 4xx — the request was rejected and the transfer was NEVER processed) we must
    // refund the reserve and fail the transaction HERE: settleSellPayout is only
    // ever reached via a webhook for a payout that was created, so for a rejected
    // request it never fires, and no outbox row was enqueued — the user's USDT
    // would be stranded in clearing forever. For an AMBIGUOUS failure (5xx /
    // timeout / no HTTP status) the transfer MIGHT be in flight, so refunding
    // would risk a double-payout; leave the tx 'settling' for the reconciler.
    let payout: Awaited<ReturnType<IPaymentProvider['createPayout']>>;
    try {
      payout = await this.callProvider('createPayout', () =>
        this.paymentProvider.createPayout({
          amount: storedQuote.fiatAmount,
          currency: storedQuote.fiatCurrency,
          reference: idempotencyKey,
          bankAccount: payoutBankAccount,
        }),
      );
    } catch (err: unknown) {
      if (this.isDefinitiveProviderRejection(err)) {
        await this.settlementRepo.settleSellRefundAtomic({
          transactionId: txn.id,
          userId,
          walletId: wallet.id,
          cryptoAmount: storedQuote.cryptoAmount,
          asset: storedQuote.asset,
          failureReason:
            'payout rejected by provider (definitive 4xx) — reserve refunded',
          now,
          // BUG 2 — reverse the velocity incremented in the atomic above so a
          // definitively-rejected sell does not consume the user's daily limit.
          velocityReversal: {
            userId,
            fiatCurrency: storedQuote.fiatCurrency,
            fiatAmountStr: storedQuote.fiatAmount,
            now,
          },
        });
      }
      throw err;
    }

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
    // Use `reference` directly (= idempotencyKey = what we passed to createPayout).
    // meta.providerRef is set atomically in executeSell so it equals reference;
    // using the incoming reference eliminates the providerRef-empty race window
    // that would occur if the process crashed between the atomic write and the
    // post-payout mergeMetadata call.
    const meta = txn.metadata as Record<string, string>;

    const verifyResult = await this.paymentProvider.verifyPayout(reference);

    if (verifyResult.status === 'pending') {
      return { transactionId: txn.id, status: 'pending', userId: txn.userId };
    }

    const walletId = meta.walletId ?? '';
    const cryptoAmount = meta.cryptoAmount ?? '0';
    const netFiatAmount = meta.netFiatAmount ?? '0';
    // WN-4: asset from transaction metadata so ledger legs key by asset.
    const sellAsset =
      (meta.asset as string | undefined) ??
      this.assetRegistry.defaultCryptoAsset();
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
          asset: sellAsset,
          // Task 6: thread fiatCurrency from metadata (no legacy rows pre-launch — fail-closed, no default).
          fiatCurrency: meta.fiatCurrency,
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
        fiatCurrency: meta.fiatCurrency,
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
      asset: sellAsset,
      failureReason: `payout verifyPayout returned status '${verifyResult.status}'`,
      now,
      // BUG 2 — reverse the daily-spend velocity this sell consumed at reserve.
      velocityReversal: this.buildVelocityReversal(txn.userId, meta, now),
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
  // Send execution (task N3b)
  // ---------------------------------------------------------------------------

  /**
   * Executes a send order after running the full server-side validation gauntlet.
   *
   * TWO-PHASE SEND:
   *   Phase 1 (this method): reserve totalDebit USDT (user_wallet → clearing) to prevent
   *   double-spend while the on-chain broadcast is in flight. Transaction status = 'settling'.
   *   Phase 2 (settleSendOnChain): on success, finalize (clearing → treasury legs);
   *   on failure, refund (clearing → user_wallet) + CompensationRecord.
   *
   * Validation gauntlet (ORDER IS SECURITY-CRITICAL):
   *   1. Load Proposal(send, status pending|confirmed, owner, not expired).
   *   2. KYC gate (server-side, always) — uses NGN-equivalent of cryptoAmount × baseRate.
   *   3. Balance re-check via ledger ≥ totalDebit (TOCTOU guard at execute time).
   *   4. Cooling-off re-check — beneficiary.firstUseLockedUntil must be null or past.
   *   5. Re-screen sanctions — complianceService.screenSendDestination.
   *   6. DirectiveService.consume (ref must be request_step_up).
   *   7. PinService.verifyPin.
   *   8. Idempotency check (after auth, before writes).
   *   9. Atomic write: Transaction(settling) + reserve ledger + Proposal→executing.
   *   10. walletService.withdraw → providerRef.
   *   11. mergeMetadata(providerRef).
   *   12. Enqueue SettlementOutbox(onchain_send).
   */
  async executeSend(input: ExecuteSendInput): Promise<ExecuteSendResult> {
    const {
      userId,
      proposalId,
      directiveId,
      nonce,
      pin,
      idempotencyKey,
      deviceId: inputDeviceId,
    } = input;
    const now = this.clock.now();

    // Fail-CLOSED: ComplianceService must always be wired. This is a hard
    // invariant — if it is missing the app is misconfigured and every send must
    // be rejected (never silently skip the sanctions re-screen, §3.3).
    if (this.complianceService === undefined) {
      throw new InternalServerErrorException(
        'ExecutionService: ComplianceService is not wired — cannot execute send (fail-closed, §3.3)',
      );
    }

    // Fail-CLOSED: SessionService must always be wired (Fix G). Device-bound
    // step-up recording is a security invariant (§3.4) — a missing SessionService
    // means the module is misconfigured.
    if (this.sessionService === undefined) {
      throw new InternalServerErrorException(
        'ExecutionService: SessionService is not wired — cannot execute send (fail-closed, Fix G §3.4)',
      );
    }

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
    if (proposal.type !== 'send') {
      throw new ProposalNotExecutableError(
        `proposal type '${proposal.type}' is not 'send'`,
      );
    }

    // Parse send-specific parameters from the proposal.
    // Send proposals have NO quote — parameters come directly from proposal.parameters.
    const params = proposal.parameters as Record<string, string>;
    const asset = params.asset ?? 'USDT';
    const cryptoAmount = params.cryptoAmount ?? '0';
    const networkFeeCrypto = params.networkFeeCrypto ?? '0';
    const totalDebit = params.totalDebit ?? '0';
    const beneficiaryId = params.beneficiaryId;
    const walletId = params.walletId;
    const toAddress = params.toAddress ?? '';
    const network = params.network;
    if (!network) {
      throw new ProposalNotExecutableError(
        'proposal parameters missing network',
      );
    }
    const requiresTravelRule = params.requiresTravelRule === 'true';

    if (!beneficiaryId) {
      throw new ProposalNotExecutableError(
        'proposal parameters missing beneficiaryId',
      );
    }
    // IMPORTANT 2: walletId null-guard — a missing walletId would silently pass
    // '0' (or undefined) to getAccountBalance and poison the ledger reserve.
    if (!walletId) {
      throw new ProposalNotExecutableError(
        'proposal parameters missing walletId',
      );
    }

    // ── Step 2: KYC gate (server-side, always) ──────────────────────────────
    // No quote on send — use cryptoAmount × baseRate for NGN-equivalent.
    // IMPORTANT 3: baseRate must be > 0. A zero/negative baseRate causes
    // ngnEquivalent=0 which silently bypasses the KYC tier gate for any amount.
    // resolveBaseRate fails closed on misconfiguration — the SAME shared guard
    // used by ProposalService so the money gate cannot be bypassed either way.
    const pricingConfig = this.config.get<PricingConfig>('pricing');
    const baseFiat = this.assetRegistry.defaultFiat();
    const baseRate = resolveBaseRate(pricingConfig, asset, baseFiat);
    // Fix-C: compute NGN equivalent using BigInt to avoid float drift.
    // baseRate is an integer NGN-per-USDT config value (e.g. 1600).
    // toScaled(cryptoAmount) returns 10^18-scaled USDT; multiplying by an integer
    // baseRate gives a 10^18-scaled NGN value — same unit as toScaled() outputs.
    const LEDGER_SCALE = 10n ** 18n;
    const scaledCryptoForGate = toScaled(cryptoAmount);
    // Exact decimal multiplication: both operands as 10^18-scaled bigints,
    // divide by SCALE once to stay in the 10^18 unit space.
    // Handles fractional baseRates (e.g. 1600.45) exactly — no Math.round.
    const scaledNgn18ForGate =
      (scaledCryptoForGate * toScaled(String(baseRate))) / LEDGER_SCALE;
    // Reconstruct decimal string from 10^18-scaled bigint (mirrors fromScaled in ledger.ts).
    const isNegNgn = scaledNgn18ForGate < 0n;
    const absNgn = isNegNgn ? -scaledNgn18ForGate : scaledNgn18ForGate;
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
      asset,
    });

    // Numeric form retained only for metadata storage (approximate use — Fix-C scope).
    const ngnEquivalent = Number(cryptoAmount) * baseRate;

    // ── Step 3: Re-check balance via ledger ≥ totalDebit (TOCTOU guard) ─────
    // Use the walletId stored in the proposal parameters (set at proposal time).
    const balance = await this.ledgerRepo.getAccountBalance(
      'user_wallet',
      walletId,
      asset,
    );

    if (toScaled(balance) < toScaled(totalDebit)) {
      throw new InsufficientBalanceError(balance, totalDebit, asset);
    }

    // ── Step 4: Cooling-off re-check ─────────────────────────────────────────
    const beneficiary = await this.beneficiaryService.getById(
      userId,
      beneficiaryId,
    );
    if (beneficiary === null) {
      throw new ProposalNotExecutableError(
        `beneficiary '${beneficiaryId}' not found`,
      );
    }
    if (
      beneficiary.firstUseLockedUntil !== null &&
      beneficiary.firstUseLockedUntil !== undefined &&
      beneficiary.firstUseLockedUntil > now
    ) {
      throw new BeneficiaryCoolingOffError(
        beneficiaryId,
        beneficiary.firstUseLockedUntil,
      );
    }

    // ── Step 5: Re-screen sanctions ───────────────────────────────────────────
    // ComplianceService is REQUIRED (non-optional). This call always runs and
    // fails CLOSED — no skip branch. §3.3: server-side check on every send.
    const screening = await this.complianceService.screenSendDestination({
      userId,
      address: toAddress,
      network,
    });
    if (!screening.passed) {
      throw new SanctionsBlockedError(
        toAddress,
        screening.reason,
        screening.complianceEventId,
        '',
      );
    }

    // ── Step 6: Verify PIN (BEFORE consuming the one-shot step-up directive) ─
    // I5: verify PIN first so a wrong-PIN typo does not burn the single-use
    // step-up grant and block a legitimate retry. The directive stays single-use
    // (consumed once on success), still expires, and is still bound to this
    // proposal; the device-bound step-up below is only recorded once BOTH PIN and
    // the directive have passed.
    await this.pinService.verifyPin(userId, pin);

    // ── Step 7: Consume directive grant ──────────────────────────────────────
    // Still consumed before the idempotency check (step 8/9) so idempotent replay
    // applies to an in-process retry holding a valid directive, not a fresh
    // re-submit.
    const grant = await this.directiveService.consume({
      directiveId,
      nonce,
      proposalId,
    });

    if (grant.directiveRef !== REQUIRED_SEND_DIRECTIVE_REF) {
      throw new ProposalNotExecutableError(
        `directive ref '${grant.directiveRef}' is not '${REQUIRED_SEND_DIRECTIVE_REF}'`,
      );
    }

    // ── Step 7b: Record device-bound step-up (Fix G, §3.4) ──────────────────
    // Resolve the acting device: use the explicit deviceId from input when
    // provided; otherwise fall back to User.pinnedDeviceId (the currently
    // trusted bound device — §3.4). Fail-CLOSED: if neither is resolvable,
    // reject — a send without a traceable device binding is a security gap.
    const resolvedDeviceId =
      inputDeviceId ?? (await this.sessionService.findPinnedDeviceId(userId));

    if (!resolvedDeviceId) {
      throw new ProposalNotExecutableError(
        'no bound device for this user — step-up cannot be recorded (fail-closed, Fix G §3.4)',
      );
    }

    // startOrTouch ensures a Session row exists for (userId, resolvedDeviceId).
    // recordStepUp persists stepUpCompletedAt = now as the auditable device
    // step-up state. Both calls happen AFTER PIN passes (inside the auth fence).
    await this.sessionService.startOrTouch(userId, resolvedDeviceId);
    await this.sessionService.recordStepUp(userId, resolvedDeviceId, now);

    // ── Step 8: Idempotency check ────────────────────────────────────────────
    const existing =
      await this.transactionRepo.findByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      const meta = existing.metadata as Record<string, string>;
      return {
        transactionId: existing.id,
        status: 'settling',
        onChain: {
          providerRef: meta.providerRef ?? existing.processorTxRef ?? '',
        },
      };
    }

    // ── Step 9: Resolve Travel Rule originator name (before atomic write) ──────
    // Call getOriginatorName only when the send is at or above the threshold
    // (requiresTravelRule=true). The KycGate reads KycProfile.firstName/lastName
    // and concatenates them; returns null when the profile is absent or both
    // name fields are empty (documented in TravelRuleData.originatorName).
    //
    // NOTE: This is an intentional read BEFORE the atomic write. The name is
    // immutable identity data (set at KYC time) so there is no race window —
    // a concurrent KYC update would not change the name mid-transaction.
    // The write stays inside the $transaction in createSendSettlingWithReserveAtomic.
    const originatorName: string | null = requiresTravelRule
      ? await this.kycGate.getOriginatorName(userId)
      : null;

    // ── Step 10: Atomic write ────────────────────────────────────────────────
    // create Transaction(send, settling) + reserve USDT (user_wallet→clearing)
    // + mark Proposal→executing — all in a SINGLE DB $transaction (C1).
    const requestChecksum = this.buildRequestChecksum({
      userId,
      proposalId,
      asset,
      fiatAmount: String(ngnEquivalent),
      fxRate: String(baseRate),
    });

    // Beneficiary name: for crypto_address beneficiaries, accountHolderName is
    // null (on-chain addresses have no KYC-verified name on our side). Use the
    // user-supplied label as the best available identifier. For bank-account
    // beneficiaries (not expected on send paths) prefer accountHolderName.
    // If neither is available, null is the correct sentinel — do NOT invent data.
    const beneficiaryName: string | null =
      beneficiary.accountHolderName ?? beneficiary.label ?? null;

    const { txn } =
      await this.settlementRepo.createSendSettlingWithReserveAtomic({
        txnData: {
          proposalId,
          userId,
          type: 'send',
          status: 'settling',
          idempotencyKey,
          requestChecksum,
          fxRateSnapshot: null,
          metadata: {
            asset,
            cryptoAmount,
            networkFeeCrypto,
            totalDebit,
            beneficiaryId,
            walletId,
            toAddress,
            network,
            // BUG 2 — persist the EXACT velocity contribution made at reserve so
            // the refund path (settleSendOnChain failure / execute 4xx) can
            // reverse it byte-for-byte. Send has no quote; the NGN-equivalent is
            // computed here from cryptoAmount × baseRate.
            velocityFiatAmount: String(ngnEquivalent),
            velocityFiatCurrency: baseFiat,
          },
          pinVerifiedAt: now,
        },
        proposalId,
        confirmedAt: now,
        velocityIncrement: {
          userId,
          fiatCurrency: baseFiat,
          fiatAmountStr: String(ngnEquivalent),
          now,
        },
        walletId,
        totalDebit,
        // WN-4: thread asset so ledger legs key by asset, not a hardcoded literal.
        asset,
        now,
        // SPEC DEVIATION fix: persist TravelRuleData atomically when threshold exceeded.
        // originatorName comes from KycProfile (getOriginatorName above); null when
        // the profile has no name data yet — documented per "any genuinely-sourceless
        // column stays null WITH a comment" requirement (fix-D).
        // beneficiaryName: accountHolderName for bank beneficiaries; label for
        // crypto-address beneficiaries (best available identifier at execute time).
        // reportedAt stays null — not yet submitted to counterparty/regulator.
        travelRule: requiresTravelRule
          ? {
              originatorUserId: userId,
              originatorName,
              beneficiaryAddress: toAddress,
              beneficiaryName,
              asset,
              cryptoAmount,
              ngnEquivalent: String(ngnEquivalent),
            }
          : null,
      });

    // ── Step 11: Initiate on-chain withdrawal ────────────────────────────────
    // Load the (user, network) wallet record (idempotent — already provisioned at propose time).
    // WN-1: network comes from proposal params; asset for withdrawal comes from params (not wallet).
    const walletRecord = await this.walletService.getOrProvisionNetworkWallet(
      userId,
      network,
    );
    const assetId = this.assetRegistry.assetProviderId(asset, 'blockradar');

    // FUNDS-SAFETY (§3.1): the reserve (Step 10, user_wallet → clearing) is already
    // committed. If the withdraw is DEFINITIVELY rejected by the provider (HTTP
    // 4xx — the request was rejected and NEVER broadcast on-chain) we must refund
    // the reserve and fail the transaction HERE: the Phase-2 webhook will never
    // fire for a request that was never accepted, and the reconciler's
    // querySendWithdrawalStatus is fail-safe 'pending' so it would never refund —
    // the user's funds would be stranded in clearing forever. For an AMBIGUOUS
    // failure (5xx / timeout / no HTTP status) the withdrawal MIGHT be in-flight,
    // so refunding would risk a double-spend (refund + the on-chain send landing);
    // we leave the tx 'settling' for the reconciler (current behaviour).
    let withdrawOutput: WithdrawOutput;
    try {
      withdrawOutput = await this.callProvider('withdraw', () =>
        this.walletService.withdraw(
          walletRecord,
          toAddress,
          cryptoAmount,
          assetId,
          idempotencyKey,
        ),
      );
    } catch (err: unknown) {
      if (this.isDefinitiveProviderRejection(err)) {
        await this.settlementRepo.settleSendRefundAtomic({
          transactionId: txn.id,
          userId,
          walletId,
          totalDebit,
          asset,
          failureReason:
            'on-chain withdrawal rejected by provider (definitive 4xx) — reserve refunded',
          now,
          // BUG 2 — reverse the velocity incremented in the atomic above so a
          // definitively-rejected send does not consume the user's daily limit.
          velocityReversal: {
            userId,
            fiatCurrency: baseFiat,
            fiatAmountStr: String(ngnEquivalent),
            now,
          },
        });
      }
      throw err;
    }
    const providerRef = withdrawOutput.providerReference;

    // ── Step 12: Persist providerRef into Transaction metadata ───────────────
    await this.transactionRepo.mergeMetadata(txn.id, { providerRef });

    // ── Step 13: Enqueue SettlementOutbox(onchain_send) ─────────────────────
    await this.outboxRepo.create({
      transactionId: txn.id,
      settlementType: 'onchain_send',
      payload: {
        reference: idempotencyKey,
        cryptoAmount,
        networkFeeCrypto,
        toAddress,
        providerRef,
      },
      idempotencyKey,
      status: 'pending',
      processorRef: providerRef,
    });

    return {
      transactionId: txn.id,
      status: 'settling',
      onChain: { providerRef },
    };
  }

  /**
   * Phase 2 of a send: finalizes or refunds the on-chain withdrawal.
   *
   * Called by a Blockradar withdraw webhook or a polling job after the
   * on-chain broadcast is confirmed or fails.
   *
   * Flow (§3.1 preserved — model proposes, engine disposes):
   *   1. Load Transaction by idempotencyKey (reference).
   *   2. Idempotent path: already completed → return existing receipt.
   *   3. Guard: status must be 'settling'.
   *   4. Route on success flag:
   *      - success=true  → settleSendFinalizeAtomic (onChainTxHash required).
   *      - success=false → settleSendRefundAtomic.
   *   5. Send WhatsApp notification (swallowed — never breaks settlement).
   */
  /**
   * Queries the actual on-chain status of a send withdrawal from the wallet
   * provider. Used by the reconciler to safely handle missed Blockradar webhooks:
   * before deciding to refund a pending `onchain_send` outbox row the reconciler
   * MUST call this method rather than assuming failure.
   *
   * Invariant (§3.1): this method is READ-ONLY — it never moves money. The
   * reconciler routes based on the result and calls `settleSendOnChain` to act.
   *
   * Returns `{ status: 'pending' }` when:
   *   - No transaction found for the reference (stale / race condition).
   *   - Transaction metadata is missing walletId or asset.
   *   - Provider query itself fails (network error, 4xx, 5xx).
   *
   * The fail-safe pending return ensures the reconciler NEVER refunds prematurely
   * on a provider error — the webhook or a later tick will finalize the row.
   */
  async querySendWithdrawalStatus(
    reference: string,
  ): Promise<QuerySendWithdrawalStatusOutput> {
    const txn = await this.transactionRepo.findByIdempotencyKey(reference);
    if (txn === null) {
      // Reference not found — fail-safe: leave pending.
      return { status: 'pending' };
    }

    const meta = txn.metadata as Record<string, string>;
    const walletId = meta.walletId;
    // asset is in metadata but not needed for network-wallet lookup (WN-1).
    const network = meta.network;

    if (!walletId) {
      // Missing wallet info in metadata — fail-safe: leave pending.
      return { status: 'pending' };
    }

    if (!network) {
      // Missing network in metadata — fail-safe: leave pending (consistent with walletId guard above).
      return { status: 'pending' };
    }

    // Load the (user, network) wallet record to get providerReference (Blockradar child address id).
    // WN-1: wallet is per-(user,network); asset for withdrawal status comes from metadata.
    const wallet = await this.walletService.getOrProvisionNetworkWallet(
      txn.userId,
      network,
    );

    return this.walletService.getWithdrawalStatus(wallet, reference);
  }

  async settleSendOnChain(
    input: SettleSendOnChainInput,
  ): Promise<SettleSendOnChainResult> {
    const { reference, success, onChainTxHash } = input;

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

    const meta = txn.metadata as Record<string, string>;
    const walletId = meta.walletId ?? '';
    const cryptoAmount = meta.cryptoAmount ?? '0';
    const networkFeeCrypto = meta.networkFeeCrypto ?? '0';
    const totalDebit = meta.totalDebit ?? '0';
    // WN-4: asset from transaction metadata so ledger legs key by asset.
    const sendAsset =
      (meta.asset as string | undefined) ??
      this.assetRegistry.defaultCryptoAsset();
    const now = this.clock.now();
    const year = now.getFullYear().toString();

    if (success) {
      // ── Step 4a: Finalize ─────────────────────────────────────────────────
      const txHash = onChainTxHash ?? '';
      const { receiptNumber } =
        await this.settlementRepo.settleSendFinalizeAtomic({
          transactionId: txn.id,
          userId: txn.userId,
          walletId,
          cryptoAmount,
          networkFeeCrypto,
          asset: sendAsset,
          onChainTxHash: txHash,
          now,
          year,
        });

      // ── Step 5a: Notify (success) — errors are swallowed, never break settlement.
      await this.notifySendComplete({
        userId: txn.userId,
        receiptNumber,
        cryptoAmount,
        toAddress: meta.toAddress ?? '',
      });

      return {
        transactionId: txn.id,
        status: 'completed',
        userId: txn.userId,
        receiptNumber,
      };
    }

    // ── Step 4b: Failure → refund + compensation ──────────────────────────────
    await this.settlementRepo.settleSendRefundAtomic({
      transactionId: txn.id,
      userId: txn.userId,
      walletId,
      totalDebit,
      asset: sendAsset,
      failureReason: 'on-chain withdrawal failed',
      now,
      // BUG 2 — reverse the daily-spend velocity this send consumed at reserve.
      velocityReversal: this.buildVelocityReversal(txn.userId, meta, now),
    });

    // ── Step 5b: Notify (failure) — errors are swallowed, never break settlement.
    await this.notifySendFailed({
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
  // Swap execution
  // ---------------------------------------------------------------------------

  /**
   * Executes a swap order after running the full server-side validation gauntlet.
   *
   * TWO-PHASE SWAP:
   *   Phase 1 (this method): reserve fromAsset (user_wallet → swap_clearing) to
   *   prevent double-spend while the provider swap is in flight. Transaction = 'settling'.
   *   Phase 2 (settleSwap): on provider confirmation, finalize (credit toAsset +
   *   debit treasury_reserve/swap_in); on failure, refund (clearing → user_wallet).
   *
   * Validation gauntlet (ORDER IS SECURITY-CRITICAL):
   *   1. Load Proposal(swap, status pending|confirmed, owner, not expired).
   *   2. Re-quote drift check against stored rate.
   *   3. Verify PIN (BEFORE consuming directive — I5 invariant).
   *   4. DirectiveService.consume (ref must be request_pin).
   *   5. Idempotency check (after auth, before writes).
   *   6. Atomic write: Transaction(settling) + reserve ledger + Proposal→executing.
   *   7. SWAP_PROVIDER.execute → providerSwapId.
   *   8. Enqueue SettlementOutbox(swap).
   */
  async executeSwap(
    input: ExecuteSwapServiceInput,
  ): Promise<ExecuteSwapResult> {
    const { userId, proposalId, directiveId, nonce, pin, idempotencyKey } =
      input;
    const now = this.clock.now();

    // Fail-CLOSED: SWAP_PROVIDER must be wired.
    if (this.swapProvider === undefined) {
      throw new Error(
        'ExecutionService: SWAP_PROVIDER is not wired — cannot execute swap',
      );
    }

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
    if (proposal.type !== 'swap') {
      throw new ProposalNotExecutableError(
        `proposal type '${proposal.type}' is not 'swap'`,
      );
    }

    const params = proposal.parameters as Record<string, string>;
    const fromAsset = params.fromAsset;
    const toAsset = params.toAsset;
    const fromAmount = params.fromAmount;
    const fromAssetId = params.fromAssetId;
    const toAssetId = params.toAssetId;
    const storedRate = Number(params.rate ?? '0');
    const walletId = params.walletId;
    const addressId = walletId; // wallet.providerReference — stored as walletId in params

    if (!walletId) {
      throw new ProposalNotExecutableError(
        'proposal parameters missing walletId',
      );
    }

    // ── Step 2: Re-quote drift check ─────────────────────────────────────────
    // Re-fetch a fresh quote from the provider to detect slippage.
    // Use stored fromAssetId / toAssetId (from proposal params).
    const freshQuote = await this.callProvider('swapGetQuote', () =>
      this.swapProvider!.getQuote({
        addressId,
        fromAssetId,
        toAssetId,
        amount: fromAmount,
      }),
    );

    const freshRate = Number(freshQuote.rate ?? '0');
    const driftBps =
      storedRate > 0
        ? (Math.abs(freshRate - storedRate) / storedRate) * 10_000
        : 0;

    if (driftBps > this.maxSwapDriftBps) {
      throw new QuoteDriftError(driftBps, this.maxSwapDriftBps);
    }

    // ── Step 3: Verify PIN (BEFORE consuming the one-shot directive) ─────────
    // I5: verify PIN first so a wrong-PIN typo does not burn the single-use
    // directive and block a legitimate retry.
    await this.pinService.verifyPin(userId, pin);

    // ── Step 4: Consume directive grant ──────────────────────────────────────
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

    // ── Step 5: Idempotency check ────────────────────────────────────────────
    const existing =
      await this.transactionRepo.findByIdempotencyKey(idempotencyKey);
    if (existing !== null) {
      const meta = existing.metadata as Record<string, string>;
      return {
        transactionId: existing.id,
        status: 'settling',
        swap: {
          providerSwapId: meta.providerSwapId ?? '',
        },
      };
    }

    // ── Step 6: Atomic write ─────────────────────────────────────────────────
    // create Transaction(swap, settling) + reserve fromAsset (user_wallet→swap_clearing)
    // + mark Proposal→executing — all in a SINGLE DB $transaction (C1).
    const pricingConfig = this.config.get<PricingConfig>('pricing');
    const baseFiat = this.assetRegistry.defaultFiat();
    const baseRate = resolveBaseRate(pricingConfig, fromAsset, baseFiat);
    const LEDGER_SCALE = 10n ** 18n;
    const scaledFromAmount = toScaled(fromAmount);
    const scaledNgn18 =
      (scaledFromAmount * toScaled(String(baseRate))) / LEDGER_SCALE;
    const isNeg = scaledNgn18 < 0n;
    const abs = isNeg ? -scaledNgn18 : scaledNgn18;
    const whole = abs / LEDGER_SCALE;
    const frac = abs % LEDGER_SCALE;
    const fracStr =
      frac === 0n
        ? ''
        : '.' + frac.toString().padStart(18, '0').replace(/0+$/, '');
    const ngnEquivalentStr = (isNeg ? '-' : '') + whole.toString() + fracStr;

    const requestChecksum = this.buildRequestChecksum({
      userId,
      proposalId,
      asset: fromAsset,
      fiatAmount: ngnEquivalentStr,
      fxRate: params.rate ?? '0',
    });

    const { txn } =
      await this.settlementRepo.createSwapSettlingWithReserveAtomic({
        txnData: {
          proposalId,
          userId,
          type: 'swap',
          status: 'settling',
          idempotencyKey,
          requestChecksum,
          fxRateSnapshot: params.rate ?? null,
          metadata: {
            fromAsset,
            toAsset,
            fromAmount,
            toAmount: params.toAmount ?? '0',
            walletId,
            // BUG 2 — persist the EXACT velocity contribution made at reserve so
            // the refund path (settleSwap failure / execute 4xx) can reverse it.
            velocityFiatAmount: ngnEquivalentStr,
            velocityFiatCurrency: baseFiat,
          },
          pinVerifiedAt: now,
        },
        proposalId,
        confirmedAt: now,
        velocityIncrement: {
          userId,
          fiatCurrency: baseFiat,
          fiatAmountStr: ngnEquivalentStr,
          now,
        },
        walletId,
        fromAmount,
        fromAsset,
        now,
      });

    // ── Step 7: Execute swap via provider ────────────────────────────────────
    // FUNDS-SAFETY (§3.1): same reserve-then-callProvider shape as executeSend.
    // The reserve (Step 6, user_wallet → swap_clearing) is already committed. On a
    // DEFINITIVE rejection (HTTP 4xx — the provider rejected the request and never
    // performed the swap) refund the reserve and fail HERE. On an AMBIGUOUS failure
    // (5xx / timeout / no status) the swap MIGHT be in-flight; leave it 'settling'
    // for the reconciler rather than risk a double-spend.
    let swapOutput: ExecuteSwapOutput;
    try {
      swapOutput = await this.callProvider('swapExecute', () =>
        this.swapProvider!.execute({
          addressId,
          fromAssetId,
          toAssetId,
          amount: fromAmount,
          reference: idempotencyKey,
        }),
      );
    } catch (err: unknown) {
      if (this.isDefinitiveProviderRejection(err)) {
        await this.settlementRepo.settleSwapRefundAtomic({
          transactionId: txn.id,
          userId,
          walletId,
          fromAmount,
          fromAsset,
          failureReason:
            'swap rejected by provider (definitive 4xx) — reserve refunded',
          now,
          // BUG 2 — reverse the velocity incremented in the atomic above so a
          // definitively-rejected swap does not consume the user's daily limit.
          velocityReversal: {
            userId,
            fiatCurrency: baseFiat,
            fiatAmountStr: ngnEquivalentStr,
            now,
          },
        });
      }
      throw err;
    }

    const providerSwapId = swapOutput.providerSwapId;

    // Persist providerSwapId into Transaction metadata for idempotent replay.
    await this.transactionRepo.mergeMetadata(txn.id, { providerSwapId });

    // ── Step 8: Enqueue SettlementOutbox ────────────────────────────────────
    await this.outboxRepo.create({
      transactionId: txn.id,
      settlementType: 'swap',
      payload: {
        reference: idempotencyKey,
        fromAsset,
        toAsset,
        fromAmount,
        providerSwapId,
      },
      idempotencyKey,
      status: 'pending',
      processorRef: providerSwapId,
    });

    return {
      transactionId: txn.id,
      status: 'settling',
      swap: { providerSwapId },
    };
  }

  /**
   * Phase 2 of a swap: credits toAsset (on success) or refunds fromAsset (on failure).
   *
   * Called by the Blockradar swap webhook or a polling job after the provider
   * confirms or rejects the swap.
   *
   * Flow (§3.1 preserved — model proposes, engine disposes):
   *   1. Load Transaction by idempotencyKey (reference).
   *   2. Idempotent path: already completed → return existing receipt.
   *   3. Guard: status must be 'settling'.
   *   4. Route on success flag:
   *      - success=true  → settleSwapFinalizeAtomic (credit toAsset).
   *      - success=false → settleSwapRefundAtomic (refund fromAsset).
   */
  async settleSwap(input: SettleSwapInput): Promise<SettleSwapResult> {
    const { reference, success, toAmount, hash } = input;

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

    const meta = txn.metadata as Record<string, string>;
    const walletId = meta.walletId ?? '';
    const fromAmount = meta.fromAmount ?? '0';
    const fromAsset = meta.fromAsset ?? '';
    const toAsset = meta.toAsset ?? '';
    const now = this.clock.now();
    const year = now.getFullYear().toString();

    if (success) {
      // FUNDS-SAFETY (§3.1, #12): a swap.success payload that omits or zeroes the
      // converted-amount field is MALFORMED. Crediting toAmount '0' would either
      // throw inside the finalize $transaction (assertPositiveDecimal) — stranding
      // the reserve in 'settling' — or credit nothing while completing the tx.
      // Treat it as not-yet-settleable: preserve the reserve (no finalize, no
      // refund) and return 'pending' so a corrected retry/webhook can finalize.
      if (toAmount === undefined || toScaled(toAmount) <= 0n) {
        this.logger.warn(
          { transactionId: txn.id, reference, toAmount },
          'settleSwap: success payload missing/zero toAmount — leaving reserve, returning pending',
        );
        return {
          transactionId: txn.id,
          status: 'pending',
          userId: txn.userId,
        };
      }

      // ── Step 4a: Finalize — credit toAsset ──────────────────────────────────
      const { receiptNumber } =
        await this.settlementRepo.settleSwapFinalizeAtomic({
          transactionId: txn.id,
          userId: txn.userId,
          walletId,
          fromAmount,
          fromAsset,
          // Guarded above: toAmount is defined and positive on this path.
          toAmount,
          toAsset,
          onChainTxHash: hash ?? '',
          now,
          year,
        });

      return {
        transactionId: txn.id,
        status: 'completed',
        userId: txn.userId,
        receiptNumber,
      };
    }

    // ── Step 4b: Failure → refund fromAsset ─────────────────────────────────
    await this.settlementRepo.settleSwapRefundAtomic({
      transactionId: txn.id,
      userId: txn.userId,
      walletId,
      fromAmount,
      fromAsset,
      failureReason: 'swap provider returned failure',
      now,
      // BUG 2 — reverse the daily-spend velocity this swap consumed at reserve.
      velocityReversal: this.buildVelocityReversal(txn.userId, meta, now),
    });

    return {
      transactionId: txn.id,
      status: 'failed',
      userId: txn.userId,
    };
  }

  /**
   * Queries the terminal status of a swap for the reconciler (#8/#11) — used to
   * safely handle a MISSED Blockradar swap webhook before deciding to finalize,
   * refund, or leave a pending `swap` outbox row open.
   *
   * Invariant (§3.1): this method is READ-ONLY — it never moves money. The
   * reconciler routes based on the result and calls `settleSwap` to act.
   *
   * The swap provider port exposes no terminal-status query (Blockradar swaps
   * are webhook-driven only). So this method is FAIL-SAFE 'pending': it can
   * confirm `success` only when a previously-processed webhook recorded the
   * converted amount + hash into the outbox payload. Without that confirmation it
   * returns 'pending' — NEVER 'failed'. This is deliberate: blind-refunding a
   * swap that actually completed on-chain would credit nothing while the toAsset
   * is already gone (platform loss), so an unconfirmable swap MUST stay open for
   * a later webhook/retry rather than be refunded. (CLAUDE.md §3.1.)
   *
   * @param payload the SettlementOutbox payload for this swap row (may carry a
   *   webhook-confirmed `toAmount`/`hash`).
   */
  querySwapStatus(
    payload?: Record<string, unknown> | null,
  ): QuerySwapStatusOutput {
    const toAmount = payload?.toAmount;
    const hash = payload?.hash;
    if (
      typeof toAmount === 'string' &&
      toAmount.length > 0 &&
      toScaled(toAmount) > 0n
    ) {
      return {
        status: 'success',
        toAmount,
        ...(typeof hash === 'string' && hash.length > 0 ? { hash } : {}),
      };
    }
    // No webhook-confirmed converted amount → cannot confirm. Fail-safe pending:
    // leave the row open for the webhook or a later tick (never blind-refund).
    return { status: 'pending' };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Sends a send-complete WhatsApp receipt to the user.
   *
   * Errors are swallowed and logged — notification failure must NEVER break
   * settlement (settlement has already committed; the on-chain send is done).
   */
  private async notifySendComplete(params: {
    userId: string;
    receiptNumber: string;
    cryptoAmount: string;
    toAddress: string;
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
        'USDT',
        params.cryptoAmount,
      );
      const body =
        `✅ Your crypto send is complete!\n` +
        `Receipt: ${params.receiptNumber}\n` +
        `You sent ${formattedCrypto} to ${params.toAddress}.`;
      await this.whatsAppSender.sendText(waAddress, body);
    } catch (err: unknown) {
      this.logger.warn(
        { userId: params.userId, err },
        'notifySendComplete: failed to send WhatsApp receipt (swallowed)',
      );
    }
  }

  /**
   * Sends a send-failed/refund WhatsApp notice to the user.
   *
   * Errors are swallowed and logged — notification failure must NEVER break
   * the refund flow (the refund ledger has already committed).
   */
  private async notifySendFailed(params: {
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
        'USDT',
        params.cryptoAmount,
      );
      const body =
        `⚠️ Send failed\n` +
        `Your ${formattedCrypto} has been refunded to your Handshake wallet.`;
      await this.whatsAppSender.sendText(waAddress, body);
    } catch (err: unknown) {
      this.logger.warn(
        { userId: params.userId, err },
        'notifySendFailed: failed to send WhatsApp notice (swallowed)',
      );
    }
  }

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
    /** Fiat currency code threaded from transaction metadata (e.g. 'NGN'). */
    fiatCurrency: string;
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
        'USDT',
        params.cryptoAmount,
      );
      const formattedFiat = this.assetRegistry.formatFiat(
        params.fiatCurrency,
        params.netFiatAmount,
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
        'USDT',
        params.cryptoAmount,
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
   * Returns true when a provider rejection is DEFINITIVE — the request was
   * rejected by the provider with an HTTP 4xx status and was therefore NEVER
   * broadcast on-chain. Only definitive rejections are safe to compensate
   * (refund a committed reserve): an AMBIGUOUS failure (5xx, network timeout, or
   * no HTTP status at all) might mean the side-effect IS in-flight, so refunding
   * would risk a double-spend (refund + the on-chain action both landing). The
   * caller leaves ambiguous failures for the reconciler. (CLAUDE.md §3.1.)
   */
  private isDefinitiveProviderRejection(err: unknown): boolean {
    const status = this.extractHttpStatus(err);
    return status !== undefined && status >= 400 && status < 500;
  }

  /**
   * Extracts the HTTP status from a provider error. The wallet/swap provider
   * adapters attach it structurally as `httpStatus` (see
   * `BlockradarProvider.wrapError`). `callProvider` re-wraps the original error
   * as the `cause` of a {@link ProviderUnavailableError}, so the status may live
   * on the error itself or on its `cause`. Returns undefined when no numeric
   * status is present — which the caller treats as an ambiguous failure.
   */
  private extractHttpStatus(err: unknown): number | undefined {
    const statusOf = (candidate: unknown): number | undefined => {
      if (
        typeof candidate === 'object' &&
        candidate !== null &&
        'httpStatus' in candidate &&
        typeof candidate.httpStatus === 'number'
      ) {
        return candidate.httpStatus;
      }
      return undefined;
    };
    return statusOf(err) ?? statusOf((err as { cause?: unknown })?.cause);
  }

  /**
   * Runs an external provider side-effect call (Flutterwave / Blockradar) and
   * translates ANY failure — non-2xx, network error, or any rejection — into a
   * typed {@link ProviderUnavailableError}. The calling surface (chat /
   * WhatsApp) maps that to a clear "provider temporarily unavailable" message
   * so a transient provider failure never leaks an opaque 500. The original
   * error is logged (provider messages may include sensitive request context,
   * so only the operation name is logged, not the raw error body — §secrets).
   */
  private async callProvider<T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err: unknown) {
      // #21/#22: SwapUnavailableError (Blockradar 404 / no-route) is a typed,
      // NON-retryable "swap not available on this account" signal — it must NOT
      // be clobbered into a retryable ProviderUnavailableError (502). Let it
      // propagate unchanged so the execute path matches the proposal path's
      // graceful semantics (web-chat surfaces a "swap isn't available" message).
      if (err instanceof SwapUnavailableError) {
        this.logger.warn(
          `provider call '${operation}' returned SwapUnavailableError — propagating unchanged`,
        );
        throw err;
      }
      this.logger.error(
        `provider call '${operation}' failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new ProviderUnavailableError(operation, err);
    }
  }

  /**
   * Builds the velocity reversal for a refund from a Transaction's metadata
   * (BUG 2). At reserve we persisted `velocityFiatAmount` + `velocityFiatCurrency`
   * — the EXACT counter contribution this tx made — so the refund can decrement
   * the same amount even if config/rates drift between execute and settle.
   *
   * Returns undefined for legacy rows that pre-date these metadata fields: a
   * refund then simply skips the reversal (no-op) rather than guessing an amount
   * and risking an over- or under-reversal of the user's daily counter.
   */
  private buildVelocityReversal(
    userId: string,
    meta: Record<string, unknown>,
    now: Date,
  ): VelocityReversal | undefined {
    const fiatAmountStr = meta.velocityFiatAmount;
    const fiatCurrency = meta.velocityFiatCurrency;
    if (
      typeof fiatAmountStr !== 'string' ||
      fiatAmountStr.length === 0 ||
      typeof fiatCurrency !== 'string' ||
      fiatCurrency.length === 0
    ) {
      return undefined;
    }
    return { userId, fiatCurrency, fiatAmountStr, now };
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
        // Task 6: thread fiatCurrency from metadata (buy path always writes it at executeBuy).
        currency: meta.fiatCurrency,
      },
    };
  }
}
