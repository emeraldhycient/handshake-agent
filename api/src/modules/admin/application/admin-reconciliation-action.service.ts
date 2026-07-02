import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  ComplianceEventItem,
  ReconActionResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { ReconciliationConfig } from '../../../core/config/configuration';
import {
  COMPLIANCE_EVENT_REPOSITORY,
  type IComplianceEventRepository,
  type ComplianceEventRecord,
  type SeverityValue,
} from '../../compliance/application/ports/compliance-event.repository.port';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
} from '../../transactions/application/ports/transaction.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  RECONCILIATION_READ_REPOSITORY,
  type IReconciliationReadRepository,
  type ReconBreakKind,
  type ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';
import { AdminTxnTriageService } from './admin-txn-triage.service';

/** Fallback stale window when the reconciliation config is absent (mirrors the read). */
const DEFAULT_STALE_AFTER_SEC = 120;

/**
 * Break kind → compliance-case severity. Mirrors the read-surface severity map
 * (over/duplicate credits are the high-severity funds-safety classes; a mismatch
 * or missing settlement is medium) so an escalated case carries the same weight the
 * operator saw on the reconciliation screen. The ComplianceEvent enum also has
 * `low`/`critical`, but no break kind maps there.
 */
const CASE_SEVERITY_BY_KIND: Record<ReconBreakKind, SeverityValue> = {
  over_credit: 'high',
  duplicate_credit: 'high',
  amount_mismatch: 'medium',
  missing_settlement: 'medium',
};

/**
 * ADM Phase 7 (WRITES) — the FUNDS-SAFETY-CRITICAL resolve / accept dispositions for
 * a provider-vs-ledger reconciliation break. It upholds §3.1 absolutely:
 *
 *   • RESOLVE is engine-brokered — it re-drives the offending transaction's
 *     settlement through the deterministic engine's EXISTING atomic path
 *     (AdminTxnTriageService.retrySettlement re-enqueues the settlement outbox for
 *     the reconciliation worker). It NEVER constructs a ledger entry, and NEVER
 *     auto-debits an over-credit from this surface — over-credits are flagged for
 *     human action, never auto-reversed here.
 *   • ACCEPT is a dual-control, NO-DEBIT disposition — it records that an operator
 *     accepted the break as-is; it moves no money and writes no ledger entry, only
 *     an immutable audit disposition.
 *
 * The break's transactionId is derived SERVER-SIDE from the break projection (never
 * trusted from the client), so a resolve can only ever re-drive the real offending
 * transaction. An unknown/closed break id fails closed (§3.6). The service holds no
 * Prisma import — it reaches data only through the injected read port + the triage
 * service (§3.2). Every disposition is immutably audited.
 */
@Injectable()
export class AdminReconciliationActionService {
  constructor(
    @Inject(RECONCILIATION_READ_REPOSITORY)
    private readonly repo: IReconciliationReadRepository,
    private readonly triage: AdminTxnTriageService,
    private readonly audit: AuditService,
    private readonly config: EffectiveConfigService,
    @Inject(COMPLIANCE_EVENT_REPOSITORY)
    private readonly events: IComplianceEventRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: ITransactionRepository,
  ) {}

  /**
   * Resolve a break by re-driving its transaction's settlement through the engine.
   * Re-enqueues the settlement outbox for the reconciliation worker — it moves no
   * money itself (`moved: false`); the engine settles/refunds atomically later.
   */
  async resolve(
    breakId: string,
    reason: string,
    adminId: string,
  ): Promise<ReconActionResponse> {
    const record = await this.requireBreak(breakId);

    // Engine-brokered: re-enqueue the offending txn's settlement. The transactionId
    // comes from the SERVER's break projection, never the client — so we can only
    // ever re-drive the real offending transaction (§3.1). Never a raw debit.
    await this.triage.retrySettlement(record.transactionId, adminId);

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `ReconBreak:${breakId}`,
      action: 'admin_override',
      before: { kind: record.kind, status: 'open' },
      after: {
        disposition: 'resolved',
        transactionId: record.transactionId,
        reason,
      },
    });

    return { breakId, disposition: 'resolved', moved: false };
  }

  /**
   * Accept a break as-is (dual-control, no debit). Records an immutable audit
   * disposition only — it calls no engine method and moves no money (`moved: false`).
   */
  async accept(
    breakId: string,
    reason: string,
    adminId: string,
  ): Promise<ReconActionResponse> {
    const record = await this.requireBreak(breakId);

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `ReconBreak:${breakId}`,
      action: 'admin_override',
      before: { kind: record.kind, status: 'open' },
      after: {
        disposition: 'accepted',
        transactionId: record.transactionId,
        reason,
      },
    });

    return { breakId, disposition: 'accepted', moved: false };
  }

  /**
   * Escalate a break into a compliance case for human review. Opens a
   * `ComplianceEvent` (status `flagged`) derived ENTIRELY from the server's break
   * projection + the break's transaction — the break's kind/delta/asset/transactionId
   * become the case details, and the owning `userId` is read SERVER-SIDE from the
   * transaction (never trusted from the client, §3.4). Moves NO money (§3.1) — it
   * only records a case + an immutable audit disposition. An unknown break id, or a
   * break whose transaction has vanished, fails closed (§3.6).
   */
  async escalate(
    breakId: string,
    reason: string,
    adminId: string,
  ): Promise<ComplianceEventItem> {
    const record = await this.requireBreak(breakId);

    // Derive the owning user from the break's transaction — the ComplianceEvent is
    // anchored to the real end user, resolved server-side (§3.4).
    const txn = await this.transactions.findById(record.transactionId);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    const event = await this.events.create({
      userId: txn.userId,
      transactionId: record.transactionId,
      // A reconciliation break is not a sanctions/AML hit — it is an operational
      // discrepancy surfaced for review, so it maps to the `unusual_pattern` class.
      eventType: 'unusual_pattern',
      severity: CASE_SEVERITY_BY_KIND[record.kind],
      screeningProvider: 'reconciliation',
      ruleOrHit: `recon_break:${record.kind}`,
      details: {
        breakId,
        kind: record.kind,
        delta: record.delta,
        asset: record.asset,
        reason,
      },
      status: 'flagged',
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `ReconBreak:${breakId}`,
      action: 'admin_review',
      before: { kind: record.kind, status: 'open' },
      after: {
        disposition: 'escalated',
        complianceEventId: event.id,
        transactionId: record.transactionId,
        reason,
      },
    });

    return toEventItem(event);
  }

  // ── private ────────────────────────────────────────────────────────────────────

  /** Load an OPEN break by id or fail closed (mapped to 404 at the controller). */
  private async requireBreak(breakId: string): Promise<ReconBreakRecord> {
    const record = await this.repo.findBreak(breakId, this.staleAfterSec());
    if (record === null) throw new AdminNotFoundError('Reconciliation break');
    return record;
  }

  /** The stale window (seconds) that scopes which pending settlements are breaks. */
  private staleAfterSec(): number {
    const recon = this.config.get<ReconciliationConfig | undefined>(
      'reconciliation',
    );
    return recon?.gracePeriodSec ?? DEFAULT_STALE_AFTER_SEC;
  }
}

// ── mapper (record → contract shape) ──────────────────────────────────────────────

/**
 * Projects the created compliance-event record into the wire `ComplianceEventItem`
 * shape (the same shape the compliance queue serves), so the escalate response is
 * consistent with the compliance-events read surface. Dates are ISO; no PII.
 */
function toEventItem(event: ComplianceEventRecord): ComplianceEventItem {
  return {
    id: event.id,
    userId: event.userId,
    transactionId: event.transactionId,
    eventType: event.eventType,
    severity: event.severity,
    status: event.status,
    screeningProvider: event.screeningProvider,
    ruleOrHit: event.ruleOrHit,
    createdAt: event.createdAt.toISOString(),
  };
}
