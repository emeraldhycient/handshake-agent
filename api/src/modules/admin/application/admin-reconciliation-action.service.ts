import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { ReconActionResponse } from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { ReconciliationConfig } from '../../../core/config/configuration';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  RECONCILIATION_READ_REPOSITORY,
  type IReconciliationReadRepository,
  type ReconBreakRecord,
} from './ports/reconciliation-read.repository.port';
import { AdminTxnTriageService } from './admin-txn-triage.service';

/** Fallback stale window when the reconciliation config is absent (mirrors the read). */
const DEFAULT_STALE_AFTER_SEC = 120;

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
