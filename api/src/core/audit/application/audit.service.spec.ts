import { AuditService } from './audit.service';
import type {
  AppendAuditInput,
  AuditAppendResult,
  IAuditLogRepository,
} from './ports/audit-log.repository.port';

function makeRepo(): {
  repo: IAuditLogRepository;
  calls: AppendAuditInput[];
} {
  const calls: AppendAuditInput[] = [];
  const repo: IAuditLogRepository = {
    append(input): Promise<AuditAppendResult> {
      calls.push(input);
      return Promise.resolve({
        id: 'id',
        prevHash: '0',
        currentHash: 'h',
        createdAt: new Date(),
      });
    },
    list: () => Promise.resolve({ items: [], nextCursor: null }),
    verifyChain: () =>
      Promise.resolve({ ok: true, checked: 0, brokenAt: null }),
  };
  return { repo, calls };
}

describe('AuditService.record', () => {
  it('derives actor "admin:<id>" when an admin id is present', async () => {
    const { repo, calls } = makeRepo();
    await new AuditService(repo).record({
      correlationId: 'c1',
      actorAdminId: 'aaaa',
      subject: 'Role:r1',
      action: 'admin_update',
    });
    expect(calls[0].actor).toBe('admin:aaaa');
    expect(calls[0].actorAdminId).toBe('aaaa');
    expect(calls[0].details).toEqual({});
  });

  it('derives actor "user:<id>" when only a user id is present', async () => {
    const { repo, calls } = makeRepo();
    await new AuditService(repo).record({
      correlationId: 'c1',
      actorUserId: 'uuuu',
      subject: 'Transaction:t1',
      action: 'execute',
    });
    expect(calls[0].actor).toBe('user:uuuu');
  });

  it('derives actor "system" when no principal is present', async () => {
    const { repo, calls } = makeRepo();
    await new AuditService(repo).record({
      correlationId: 'c1',
      subject: 'AuditLog:chain',
      action: 'audit_chain_check',
    });
    expect(calls[0].actor).toBe('system');
  });

  it('forwards before/after snapshots through to the repository', async () => {
    const { repo, calls } = makeRepo();
    await new AuditService(repo).record({
      correlationId: 'c1',
      actorAdminId: 'aaaa',
      subject: 'Role:r1',
      action: 'admin_update',
      before: { x: 1 },
      after: { x: 2 },
    });
    expect(calls[0].before).toEqual({ x: 1 });
    expect(calls[0].after).toEqual({ x: 2 });
  });
});
