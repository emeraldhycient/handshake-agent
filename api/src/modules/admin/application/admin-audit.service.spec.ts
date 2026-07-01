import { AdminAuditService } from './admin-audit.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type {
  AuditListQuery,
  AuditListResult,
  AuditLogRecord,
} from '../../../core/audit/application/ports/audit-log.repository.port';
import type {
  AdminUserRecord,
  IAdminUserRepository,
} from './ports/admin-user.repository.port';

const ADMIN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeRecord(over?: Partial<AuditLogRecord>): AuditLogRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    correlationId: 'corr-1',
    actor: `admin:${ADMIN_A}`,
    actorUserId: null,
    actorAdminId: ADMIN_A,
    subject: 'User:abc',
    action: 'admin_review',
    details: { reason: 'suspicious velocity' },
    before: null,
    after: { status: 'blocked' },
    prevHash: 'p',
    currentHash: 'c',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
    ...over,
  };
}

function makeAdmin(over?: Partial<AdminUserRecord>): AdminUserRecord {
  return {
    id: ADMIN_A,
    email: 'ops@example.com',
    status: 'active',
    mfaEnabled: true,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    roleId: 'role-1',
    roleName: 'Compliance officer',
    createdAt: new Date(),
    lastLoginAt: null,
    ...over,
  };
}

function makeAudit(result: AuditListResult): {
  audit: Pick<AuditService, 'list' | 'verifyChain'>;
  listCalls: AuditListQuery[];
} {
  const listCalls: AuditListQuery[] = [];
  const audit = {
    list(query: AuditListQuery): Promise<AuditListResult> {
      listCalls.push(query);
      return Promise.resolve(result);
    },
    verifyChain: () =>
      Promise.resolve({ ok: true, checked: 3, brokenAt: null }),
  };
  return { audit, listCalls };
}

function makeUsers(byId: Record<string, AdminUserRecord | null>): {
  users: Pick<IAdminUserRepository, 'findById'>;
  findByIdCalls: string[];
} {
  const findByIdCalls: string[] = [];
  const users = {
    findById(id: string): Promise<AdminUserRecord | null> {
      findByIdCalls.push(id);
      return Promise.resolve(byId[id] ?? null);
    },
  };
  return { users, findByIdCalls };
}

describe('AdminAuditService.list', () => {
  it('resolves the actor admin role and projects details.reason', async () => {
    const { audit } = makeAudit({
      items: [makeRecord()],
      nextCursor: null,
    });
    const { users } = makeUsers({ [ADMIN_A]: makeAdmin() });
    const service = new AdminAuditService(
      audit as AuditService,
      users as IAdminUserRepository,
    );

    const result = await service.list({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0].actorRole).toBe('Compliance officer');
    expect(result.items[0].reason).toBe('suspicious velocity');
    expect(result.nextCursor).toBeNull();
  });

  it('sets actorRole null for a system/user actor (no actorAdminId)', async () => {
    const { audit } = makeAudit({
      items: [
        makeRecord({
          actor: `user:${USER_ID}`,
          actorAdminId: null,
          actorUserId: USER_ID,
          details: {},
        }),
      ],
      nextCursor: null,
    });
    const { users, findByIdCalls } = makeUsers({});
    const service = new AdminAuditService(
      audit as AuditService,
      users as IAdminUserRepository,
    );

    const result = await service.list({});

    expect(result.items[0].actorRole).toBeNull();
    expect(result.items[0].reason).toBeNull();
    // No admin id → no lookup.
    expect(findByIdCalls).toEqual([]);
  });

  it('sets actorRole null when the admin cannot be resolved', async () => {
    const { audit } = makeAudit({
      items: [makeRecord({ actorAdminId: ADMIN_B, details: {} })],
      nextCursor: null,
    });
    const { users } = makeUsers({ [ADMIN_B]: null });
    const service = new AdminAuditService(
      audit as AuditService,
      users as IAdminUserRepository,
    );

    const result = await service.list({});

    expect(result.items[0].actorRole).toBeNull();
  });

  it('resolves each distinct admin exactly once (no N+1 per row)', async () => {
    const { audit } = makeAudit({
      items: [
        makeRecord({ id: 'r1', actorAdminId: ADMIN_A }),
        makeRecord({ id: 'r2', actorAdminId: ADMIN_A }),
        makeRecord({ id: 'r3', actorAdminId: ADMIN_B }),
      ],
      nextCursor: 'r3',
    });
    const { users, findByIdCalls } = makeUsers({
      [ADMIN_A]: makeAdmin({ id: ADMIN_A, roleName: 'Compliance officer' }),
      [ADMIN_B]: makeAdmin({ id: ADMIN_B, roleName: 'Treasury' }),
    });
    const service = new AdminAuditService(
      audit as AuditService,
      users as IAdminUserRepository,
    );

    const result = await service.list({});

    expect(findByIdCalls.sort()).toEqual([ADMIN_A, ADMIN_B].sort());
    expect(result.items[0].actorRole).toBe('Compliance officer');
    expect(result.items[2].actorRole).toBe('Treasury');
    expect(result.nextCursor).toBe('r3');
  });

  it('ignores a non-string details.reason', async () => {
    const { audit } = makeAudit({
      items: [makeRecord({ details: { reason: 42 } })],
      nextCursor: null,
    });
    const { users } = makeUsers({ [ADMIN_A]: makeAdmin() });
    const service = new AdminAuditService(
      audit as AuditService,
      users as IAdminUserRepository,
    );

    const result = await service.list({});

    expect(result.items[0].reason).toBeNull();
  });

  it('forwards the query filters through to the audit service', async () => {
    const { audit, listCalls } = makeAudit({ items: [], nextCursor: null });
    const { users } = makeUsers({});
    const service = new AdminAuditService(
      audit as AuditService,
      users as IAdminUserRepository,
    );

    const query = {
      subject: 'User:abc',
      action: 'admin_review' as const,
      limit: 25,
    };
    await service.list(query);

    expect(listCalls).toEqual([query]);
  });
});

describe('AdminAuditService.verifyChain', () => {
  it('delegates to the audit service', async () => {
    const { audit } = makeAudit({ items: [], nextCursor: null });
    const { users } = makeUsers({});
    const service = new AdminAuditService(
      audit as AuditService,
      users as IAdminUserRepository,
    );

    const result = await service.verifyChain();

    expect(result).toEqual({ ok: true, checked: 3, brokenAt: null });
  });
});
