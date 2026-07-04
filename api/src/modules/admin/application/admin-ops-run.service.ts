import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AdminOpsRunResponse } from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { ReconciliationPersistenceService } from '../../transactions/application/reconciliation-persistence.service';
import { AdminNotFoundError } from '../domain/admin-errors';

/**
 * ADM Phase 7 (WRITE) — the "Run now" trigger for a declared background job on the
 * System/ops board. This is engine-brokered OVERSIGHT, not a money movement: running
 * a job re-drives an EXISTING deterministic worker; it NEVER constructs a ledger
 * entry, settles inline, or moves money itself (§3.1). The reconciler's own atomic,
 * idempotent settle path is what actually processes any pending rows.
 *
 * The set of manually-triggerable jobs is a fixed allow-list keyed to the declared
 * cron registry (mirrors the ops-read repository's `JOBS`). Only jobs the platform
 * exposes an out-of-band trigger for actually invoke a worker; a declared-but-not-
 * triggerable job is a recorded no-op (triggered:false) rather than a fabricated
 * success. An unknown job id fails closed (§3.6).
 *
 * The service holds no Prisma import — it reaches the worker only through the
 * injected ReconciliationPersistenceService, which persists a durable ReconRun for
 * the manual run just as the cron does (§3.2). Every attempt is audited.
 */

/** The declared jobs the board surfaces (mirrors the ops-read `JOBS` registry). */
const KNOWN_JOB_IDS: ReadonlySet<string> = new Set([
  'settlement-reconciliation',
  'child-address-sweep',
  'sanctions-refresh',
  'statement-link-regen',
]);

/** The reconciler is the only job with an exposed out-of-band manual trigger. */
const RECONCILIATION_JOB_ID = 'settlement-reconciliation';

@Injectable()
export class AdminOpsRunService {
  constructor(
    private readonly reconciler: ReconciliationPersistenceService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Trigger a manual run of a declared background job. Only the reconciliation job
   * has an exposed out-of-band trigger today — it re-drives the engine's settlement
   * worker (moving no money). Other declared jobs are recorded no-ops. An unknown
   * job id fails closed with a NotFound (mapped to 404 at the controller).
   */
  async run(
    jobId: string,
    reason: string,
    adminId: string,
  ): Promise<AdminOpsRunResponse> {
    if (!KNOWN_JOB_IDS.has(jobId)) throw new AdminNotFoundError('Ops job');

    const triggered = jobId === RECONCILIATION_JOB_ID;
    if (triggered) {
      // Re-drive the reconciliation worker through the persistence wrapper so the
      // manual run is recorded as a durable ReconRun (like the cron). The settle
      // path is idempotent + atomic — this only asks it to run now.
      await this.reconciler.runSettlementReconciliation();
    }

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `OpsJob:${jobId}`,
      action: 'admin_override',
      after: { action: 'manual_run', triggered, reason },
    });

    return {
      jobId,
      triggered,
      status: triggered ? 'running' : 'idle',
    };
  }
}
