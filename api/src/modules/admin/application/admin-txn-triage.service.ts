import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  ReconBreak,
  ReconBreakListResponse,
  ReconBreakSeverity,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { CLOCK, type Clock } from '../../../core/common/clock';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { ReconciliationConfig } from '../../../core/config/configuration';
import {
  SETTLEMENT_REPOSITORY,
  type ISettlementRepository,
} from '../../transactions/application/ports/settlement.repository.port';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
  type TransactionRecord,
} from '../../transactions/application/ports/transaction.repository.port';
import {
  SETTLEMENT_OUTBOX_REPOSITORY,
  type ISettlementOutboxRepository,
} from '../../transactions/application/ports/settlement-outbox.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import { TxnNotTriageableError } from '../domain/txn-triage-errors';
import {
  RECONCILIATION_READ_REPOSITORY,
  type IReconciliationReadRepository,
  type ReconBreakKind,
  type ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';

/** Outcome of a triage action (mark-failed or retry). */
export interface AdminTxnActionResult {
  transactionId: string;
  status: string;
  refunded: boolean;
}

/** Transaction types that hold a user reserve that mark-failed can reverse. */
type RefundableType = 'sell' | 'send' | 'swap';
const REFUNDABLE_TYPES: ReadonlySet<string> = new Set<RefundableType>([
  'sell',
  'send',
  'swap',
]);

/** Fallback stale window when the reconciliation config is absent (mirrors the read). */
const DEFAULT_STALE_AFTER_SEC = 120;

/** Break kind → severity: over/duplicate credits are high; the rest medium (read parity). */
const SEVERITY_BY_KIND: Record<ReconBreakKind, ReconBreakSeverity> = {
  over_credit: 'high',
  duplicate_credit: 'high',
  amount_mismatch: 'medium',
  missing_settlement: 'medium',
};

/**
 * ADM Phase 3 (sub-area B) — engine-brokered, audited, idempotent admin TRIAGE of
 * stuck transactions. This is the MONEY PATH, so it preserves the §3.1 invariant
 * absolutely: it NEVER constructs a ledger entry or mutates a Transaction row
 * directly. A mark-failed routes through the deterministic engine's existing
 * atomic refund methods (`settle{Sell,Send,Swap}RefundAtomic`), which reverse the
 * reserve, mark the txn failed, write the CompensationRecord and reverse velocity
 * — atomically and idempotently on the txn. A retry only re-arms the settlement
 * outbox row for the existing reconciliation worker; it never settles inline.
 */
@Injectable()
export class AdminTxnTriageService {
  constructor(
    @Inject(SETTLEMENT_REPOSITORY)
    private readonly settlement: ISettlementRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: ITransactionRepository,
    @Inject(SETTLEMENT_OUTBOX_REPOSITORY)
    private readonly outbox: ISettlementOutboxRepository,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RECONCILIATION_READ_REPOSITORY)
    private readonly recon: IReconciliationReadRepository,
    private readonly config: EffectiveConfigService,
  ) {}

  /**
   * Marks a stuck SETTLING transaction failed and refunds its reserve via the
   * engine's atomic refund method for its type.
   *
   * Idempotent: an already-failed txn returns the failed/refunded outcome WITHOUT
   * calling refund again (no double-credit). A non-settling txn (completed /
   * pending / rolled_back) or a type that holds no user reserve (buy / deposit /
   * reward / refund) is rejected with TxnNotTriageableError.
   */
  async markFailedAndRefund(
    txnId: string,
    reason: string,
    adminId: string,
  ): Promise<AdminTxnActionResult> {
    const txn = await this.transactions.findById(txnId);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    // Idempotent no-op: the reserve was already reversed on a prior run (or by the
    // engine's own failure path). Do not refund again — that would double-credit.
    if (txn.status === 'failed') {
      return { transactionId: txn.id, status: 'failed', refunded: true };
    }

    // Only a settling txn (reserve posted, settlement in flight) is triageable.
    if (txn.status !== 'settling') {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is '${txn.status}', not 'settling' — nothing to triage.`,
      );
    }

    if (!REFUNDABLE_TYPES.has(txn.type)) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is a '${txn.type}' — no reserve to refund.`,
      );
    }

    const now = this.clock.now();
    await this.refundByType(txn, reason, now);

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Transaction:${txn.id}`,
      action: 'admin_override',
      before: { status: 'settling' },
      after: { status: 'failed', reason },
    });

    return { transactionId: txn.id, status: 'failed', refunded: true };
  }

  /**
   * Re-enqueues a stuck transaction's settlement for the existing reconciliation
   * worker by resetting its outbox row to pending. NEVER settles inline (§3.1) and
   * NEVER moves money — `refunded` is always false.
   */
  async retrySettlement(
    txnId: string,
    adminId: string,
  ): Promise<AdminTxnActionResult> {
    const txn = await this.transactions.findById(txnId);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    const row = await this.outbox.findByTransactionId(txn.id);
    if (row === null) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} has no settlement to retry.`,
      );
    }

    await this.outbox.resetToPending(row.id);

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Transaction:${txn.id}`,
      action: 'admin_override',
      before: { settlementStatus: row.status },
      after: { action: 'retry_enqueued' },
    });

    return { transactionId: txn.id, status: txn.status, refunded: false };
  }

  /**
   * Re-runs provider-vs-ledger reconciliation for ONE transaction and surfaces any
   * break it currently exhibits. This is READ-ONLY DETECTION (distinct from
   * `retrySettlement`, which re-arms the settlement outbox): it re-runs the same
   * projection the reconciliation screen uses, scoped to this transaction, and moves
   * NO money and mutates NO ledger row (§3.1). An unknown transaction fails closed
   * (§3.6). `reason` is an optional audited note. Returns the detected breaks (empty
   * when the transaction reconciles cleanly).
   */
  async rerunReconciliation(
    txnId: string,
    adminId: string,
    reason?: string,
  ): Promise<ReconBreakListResponse> {
    const txn = await this.transactions.findById(txnId);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    const records = await this.recon.findBreaksByTransactionId(
      txn.id,
      this.staleAfterSec(),
    );

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Transaction:${txn.id}`,
      action: 'admin_review',
      before: null,
      after: {
        action: 'reconciliation_rerun',
        breakCount: records.length,
        reason: reason ?? null,
      },
    });

    return { items: records.map((row) => toBreak(row)) };
  }

  // ── private ───────────────────────────────────────────────────────────────────

  /** The stale window (seconds) that scopes which pending settlements are breaks. */
  private staleAfterSec(): number {
    const recon = this.config.get<ReconciliationConfig | undefined>(
      'reconciliation',
    );
    return recon?.gracePeriodSec ?? DEFAULT_STALE_AFTER_SEC;
  }

  /**
   * Dispatches to the engine's atomic refund method for the txn type, reading the
   * reserve amount + asset + walletId from the txn metadata EXACTLY as the engine's
   * own failure path does (execution.service.ts settle{Sell,Send,Swap} call sites).
   */
  private async refundByType(
    txn: TransactionRecord,
    reason: string,
    now: Date,
  ): Promise<void> {
    const meta = txn.metadata as Record<string, string | undefined>;
    const walletId = meta.walletId;
    if (walletId === undefined || walletId === '') {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} metadata has no walletId — cannot refund.`,
      );
    }

    if (txn.type === 'sell') {
      const { asset, cryptoAmount } = this.requireReserve(txn, meta, [
        'asset',
        'cryptoAmount',
      ]);
      await this.settlement.settleSellRefundAtomic({
        transactionId: txn.id,
        userId: txn.userId,
        walletId,
        cryptoAmount,
        asset,
        failureReason: reason,
        now,
      });
      return;
    }

    if (txn.type === 'send') {
      const { asset, totalDebit } = this.requireReserve(txn, meta, [
        'asset',
        'totalDebit',
      ]);
      await this.settlement.settleSendRefundAtomic({
        transactionId: txn.id,
        userId: txn.userId,
        walletId,
        totalDebit,
        asset,
        failureReason: reason,
        now,
      });
      return;
    }

    // swap (the only remaining refundable type — gated by REFUNDABLE_TYPES).
    const { fromAsset, fromAmount } = this.requireReserve(txn, meta, [
      'fromAsset',
      'fromAmount',
    ]);
    await this.settlement.settleSwapRefundAtomic({
      transactionId: txn.id,
      userId: txn.userId,
      walletId,
      fromAmount,
      fromAsset,
      failureReason: reason,
      now,
    });
  }

  /**
   * Reads required reserve fields from metadata, throwing TxnNotTriageableError
   * if any is missing/empty. Corrupt metadata must NEVER fall back to a guessed
   * asset/amount (that could refund the wrong amount) — fail closed instead.
   */
  private requireReserve(
    txn: TransactionRecord,
    meta: Record<string, string | undefined>,
    keys: string[],
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of keys) {
      const value = meta[key];
      if (value === undefined || value === '') {
        throw new TxnNotTriageableError(
          `Transaction ${txn.id} metadata is missing '${key}' — cannot safely refund.`,
        );
      }
      out[key] = value;
    }
    return out;
  }
}

// ── mapper (record → contract shape) ──────────────────────────────────────────────

/**
 * Projects a per-transaction break record into the wire `ReconBreak` shape, deriving
 * its severity from the kind exactly as the reconciliation read surface does, so the
 * re-run result is consistent with the reconciliation screen. Every projected break
 * is `open` (a re-run only detects). Dates are ISO; no PII crosses this boundary.
 */
function toBreak(row: ReconBreakRecord): ReconBreak {
  return {
    id: row.id,
    kind: row.kind,
    severity: SEVERITY_BY_KIND[row.kind],
    transactionId: row.transactionId,
    asset: row.asset,
    delta: row.delta,
    detail: row.detail,
    status: 'open',
    detectedAt: row.detectedAt.toISOString(),
  };
}
