import type { PersistedReconBreak, ReconRun } from '@handshake-agent/contracts';

import type {
  ReconBreakRecord,
  ReconRunRecord,
} from '../../transactions/application/ports/reconciliation.repository.port';

/**
 * Record → contract mappers for the durable reconciliation run + break (Go-readiness
 * #3). Shared by the read service (history/detail) and the action service
 * (acknowledge/resolve response) so the wire shape can never drift between them.
 * Dates are ISO; the delta is already a byte-stable string; no PII (§3.4).
 */

export function toReconRunContract(r: ReconRunRecord): ReconRun {
  return {
    id: r.id,
    runType: r.runType,
    status: r.status,
    totalChecked: r.totalChecked,
    breaksDetected: r.breaksDetected,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt !== null ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toPersistedBreakContract(
  b: ReconBreakRecord,
): PersistedReconBreak {
  return {
    id: b.id,
    reconRunId: b.reconRunId,
    breakType: b.breakType,
    userId: b.userId,
    walletId: b.walletId,
    outboxId: b.outboxId,
    currency: b.currency,
    delta: b.delta,
    status: b.status,
    approvedByAdminId: b.approvedByAdminId,
    reason: b.reason,
    actionAt: b.actionAt !== null ? b.actionAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
