import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminUserService } from './admin-user.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  AdminUserRecord,
  IAdminUserRepository,
  ListAdminUsersResult,
} from './ports/admin-user.repository.port';
import type { IAdminSessionRepository } from './ports/admin-session.repository.port';

function makeUser(over?: Partial<AdminUserRecord>): AdminUserRecord {
  return {
    id: 'user-1',
    email: 'a@b.co',
    displayName: 'a',
    status: 'active',
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    roleId: 'role-1',
    roleName: 'super_admin',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    failedLoginCount: 0,
    loginLockedUntil: null,
    ...over,
  };
}

function makeUserRepo(user?: AdminUserRecord | null): {
  repo: IAdminUserRepository;
  roleUpdates: { id: string; roleId: string }[];
  statusUpdates: { id: string; status: string; at: Date }[];
  listCalls: unknown[];
} {
  const roleUpdates: { id: string; roleId: string }[] = [];
  const statusUpdates: { id: string; status: string; at: Date }[] = [];
  const listCalls: unknown[] = [];
  const listResult: ListAdminUsersResult = { items: [], nextCursor: null };
  const repo = {
    findById: () => Promise.resolve(user === undefined ? makeUser() : user),
    list(query: unknown): Promise<ListAdminUsersResult> {
      listCalls.push(query);
      return Promise.resolve(listResult);
    },
    updateRole(id: string, roleId: string): Promise<void> {
      roleUpdates.push({ id, roleId });
      return Promise.resolve();
    },
    setStatus(id: string, status: string, at: Date): Promise<void> {
      statusUpdates.push({ id, status, at });
      return Promise.resolve();
    },
  } as unknown as IAdminUserRepository;
  return { repo, roleUpdates, statusUpdates, listCalls };
}

function makeSessionRepo(): {
  repo: IAdminSessionRepository;
  revokeAllCalls: { adminUserId: string; at: Date }[];
} {
  const revokeAllCalls: { adminUserId: string; at: Date }[] = [];
  const repo = {
    revokeAllForAdmin(adminUserId: string, at: Date): Promise<void> {
      revokeAllCalls.push({ adminUserId, at });
      return Promise.resolve();
    },
  } as unknown as IAdminSessionRepository;
  return { repo, revokeAllCalls };
}

function makeAudit(): { audit: AuditService; calls: RecordAuditInput[] } {
  const calls: RecordAuditInput[] = [];
  const audit = {
    record(input: RecordAuditInput): Promise<void> {
      calls.push(input);
      return Promise.resolve();
    },
  } as unknown as AuditService;
  return { audit, calls };
}

describe('AdminUserService', () => {
  describe('get', () => {
    it('returns the user when present', async () => {
      const users = makeUserRepo(makeUser({ id: 'u9' }));
      const sessions = makeSessionRepo();
      const { audit } = makeAudit();

      const result = await new AdminUserService(
        users.repo,
        sessions.repo,
        audit,
      ).get('u9');
      expect(result.id).toBe('u9');
    });

    it('throws AdminNotFoundError when absent', async () => {
      const users = makeUserRepo(null);
      const sessions = makeSessionRepo();
      const { audit } = makeAudit();

      await expect(
        new AdminUserService(users.repo, sessions.repo, audit).get('missing'),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
    });
  });

  describe('updateRole', () => {
    it('updates the role and audits admin_update', async () => {
      const users = makeUserRepo();
      const sessions = makeSessionRepo();
      const { audit, calls } = makeAudit();
      const now = new Date('2026-06-30T00:00:00Z');

      await new AdminUserService(users.repo, sessions.repo, audit).updateRole(
        'user-1',
        'role-2',
        'admin-9',
        now,
      );

      expect(users.roleUpdates).toEqual([{ id: 'user-1', roleId: 'role-2' }]);
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('admin_update');
      expect(calls[0].subject).toBe('AdminUser:user-1');
      expect(calls[0].actorAdminId).toBe('admin-9');
    });
  });

  describe('setStatus', () => {
    it('offboarded revokes all sessions and audits', async () => {
      const users = makeUserRepo();
      const sessions = makeSessionRepo();
      const { audit, calls } = makeAudit();
      const now = new Date('2026-06-30T00:00:00Z');

      await new AdminUserService(users.repo, sessions.repo, audit).setStatus(
        'user-1',
        'offboarded',
        'admin-9',
        now,
      );

      expect(users.statusUpdates).toEqual([
        { id: 'user-1', status: 'offboarded', at: now },
      ]);
      expect(sessions.revokeAllCalls).toEqual([
        { adminUserId: 'user-1', at: now },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('admin_update');
      expect(calls[0].subject).toBe('AdminUser:user-1');
    });

    it('suspended does NOT revoke sessions', async () => {
      const users = makeUserRepo();
      const sessions = makeSessionRepo();
      const { audit, calls } = makeAudit();
      const now = new Date('2026-06-30T00:00:00Z');

      await new AdminUserService(users.repo, sessions.repo, audit).setStatus(
        'user-1',
        'suspended',
        'admin-9',
        now,
      );

      expect(users.statusUpdates).toEqual([
        { id: 'user-1', status: 'suspended', at: now },
      ]);
      expect(sessions.revokeAllCalls).toHaveLength(0);
      expect(calls).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('forwards the query to the repository', async () => {
      const users = makeUserRepo();
      const sessions = makeSessionRepo();
      const { audit } = makeAudit();

      await new AdminUserService(users.repo, sessions.repo, audit).list({
        limit: 5,
      });
      expect(users.listCalls).toEqual([{ limit: 5 }]);
    });
  });
});
