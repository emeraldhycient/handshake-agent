import { AdminOpsRunService } from './admin-ops-run.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import type { ReconciliationPersistenceService } from '../../transactions/application/reconciliation-persistence.service';
import type { AuditService } from '../../../core/audit/application/audit.service';

const ADMIN_ID = 'admin-uuid-1';

function makeReconciler(): jest.Mocked<
  Pick<ReconciliationPersistenceService, 'runSettlementReconciliation'>
> {
  return { runSettlementReconciliation: jest.fn().mockResolvedValue({}) };
}

function makeAudit(): jest.Mocked<AuditService> {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
}

describe('AdminOpsRunService', () => {
  let reconciler: ReturnType<typeof makeReconciler>;
  let audit: ReturnType<typeof makeAudit>;
  let service: AdminOpsRunService;

  beforeEach(() => {
    reconciler = makeReconciler();
    audit = makeAudit();
    service = new AdminOpsRunService(
      reconciler as unknown as ReconciliationPersistenceService,
      audit,
    );
  });

  it('triggers the settlement-reconciliation job by re-driving the engine worker (and persisting the run)', async () => {
    const result = await service.run(
      'settlement-reconciliation',
      'Backlog cleared upstream; re-driving.',
      ADMIN_ID,
    );

    expect(reconciler.runSettlementReconciliation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      jobId: 'settlement-reconciliation',
      triggered: true,
      status: 'running',
    });
  });

  it('audits the manual run as an admin override', async () => {
    await service.run('settlement-reconciliation', 'why', ADMIN_ID);

    expect(audit.record).toHaveBeenCalledTimes(1);
    const arg = audit.record.mock.calls[0][0];
    expect(arg.actorAdminId).toBe(ADMIN_ID);
    expect(arg.action).toBe('admin_override');
    expect(arg.subject).toBe('OpsJob:settlement-reconciliation');
  });

  it('rejects an unknown job id (fail-closed, no worker call)', async () => {
    await expect(
      service.run('no-such-job', 'why', ADMIN_ID),
    ).rejects.toBeInstanceOf(AdminNotFoundError);
    expect(reconciler.runSettlementReconciliation).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a declared-but-not-manually-triggerable job as not triggered', async () => {
    // `sanctions-refresh` is a declared cron with no out-of-band trigger exposed:
    // running it is a no-op (triggered:false) rather than a fabricated success.
    const result = await service.run('sanctions-refresh', 'why', ADMIN_ID);

    expect(reconciler.runSettlementReconciliation).not.toHaveBeenCalled();
    expect(result).toEqual({
      jobId: 'sanctions-refresh',
      triggered: false,
      status: 'idle',
    });
    // Still audited — the attempt is recorded even when it is a no-op.
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});
