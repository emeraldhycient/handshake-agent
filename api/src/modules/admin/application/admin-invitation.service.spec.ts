import { createHash } from 'node:crypto';

import { AdminInvitationInvalidError } from '../domain/admin-errors';
import { AdminInvitationService } from './admin-invitation.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  ActiveAdminInvitationRecord,
  AdminInvitationCreatedRecord,
  CreateAdminInvitationInput,
  IAdminInvitationRepository,
} from './ports/admin-invitation.repository.port';
import type {
  AdminUserRecord,
  CreateInvitedAdminInput,
  IAdminUserRepository,
} from './ports/admin-user.repository.port';

function sha256(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

function makeUser(over?: Partial<AdminUserRecord>): AdminUserRecord {
  return {
    id: 'user-1',
    email: 'a@b.co',
    status: 'pending',
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
    roleId: 'role-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    ...over,
  };
}

function makeInvRepo(active?: ActiveAdminInvitationRecord | null): {
  repo: IAdminInvitationRepository;
  creates: CreateAdminInvitationInput[];
  accepted: { id: string; at: Date }[];
} {
  const creates: CreateAdminInvitationInput[] = [];
  const accepted: { id: string; at: Date }[] = [];
  const repo: IAdminInvitationRepository = {
    create(input): Promise<AdminInvitationCreatedRecord> {
      creates.push(input);
      return Promise.resolve({
        id: 'inv-1',
        email: input.email,
        expiresAt: input.expiresAt,
      });
    },
    findActiveByTokenHash: () => Promise.resolve(active ?? null),
    markAccepted(id, at): Promise<void> {
      accepted.push({ id, at });
      return Promise.resolve();
    },
    countAdmins: () => Promise.resolve(0),
  };
  return { repo, creates, accepted };
}

function makeUserRepo(user?: AdminUserRecord | null): {
  repo: IAdminUserRepository;
  invited: CreateInvitedAdminInput[];
  activated: { id: string; passwordHash: string; at: Date }[];
} {
  const invited: CreateInvitedAdminInput[] = [];
  const activated: { id: string; passwordHash: string; at: Date }[] = [];
  const repo = {
    createInvited(input: CreateInvitedAdminInput): Promise<AdminUserRecord> {
      invited.push(input);
      return Promise.resolve(
        makeUser({ email: input.email, roleId: input.roleId }),
      );
    },
    findByEmail: () => Promise.resolve(user === undefined ? makeUser() : user),
    setPasswordAndActivate(
      id: string,
      passwordHash: string,
      at: Date,
    ): Promise<void> {
      activated.push({ id, passwordHash, at });
      return Promise.resolve();
    },
  } as unknown as IAdminUserRepository;
  return { repo, invited, activated };
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

describe('AdminInvitationService', () => {
  describe('create', () => {
    it('makes a pending user + invitation and returns a one-time token', async () => {
      const inv = makeInvRepo();
      const users = makeUserRepo();
      const { audit, calls } = makeAudit();
      const now = new Date('2026-06-30T00:00:00Z');

      const result = await new AdminInvitationService(
        inv.repo,
        users.repo,
        audit,
      ).create(
        { email: 'new@b.co', roleId: 'role-2', reason: 'ops hire' },
        'admin-1',
        now,
      );

      // pending user created
      expect(users.invited).toEqual([{ email: 'new@b.co', roleId: 'role-2' }]);

      // invitation stores only the token hash + expiry = now + 7d
      expect(inv.creates).toHaveLength(1);
      const created = inv.creates[0];
      expect(created.email).toBe('new@b.co');
      expect(created.roleId).toBe('role-2');
      expect(created.createdByAdminId).toBe('admin-1');
      expect(created.reason).toBe('ops hire');
      expect(created.expiresAt.getTime()).toBe(
        now.getTime() + 7 * 24 * 3600 * 1000,
      );
      expect(created.tokenHash).toBe(sha256(result.invitationToken));

      // returned token is plaintext (not the stored hash)
      expect(result.invitationToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.invitationToken).not.toBe(created.tokenHash);
      expect(result.id).toBe('inv-1');
      expect(result.email).toBe('new@b.co');

      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('admin_update');
      expect(calls[0].subject).toBe('AdminInvitation:inv-1');
      expect(calls[0].actorAdminId).toBe('admin-1');
    });
  });

  describe('accept', () => {
    it('activates the user, marks the invitation accepted, and returns the admin id', async () => {
      const active: ActiveAdminInvitationRecord = {
        id: 'inv-1',
        email: 'a@b.co',
        roleId: 'role-1',
      };
      const inv = makeInvRepo(active);
      const users = makeUserRepo(makeUser({ id: 'user-1', email: 'a@b.co' }));
      const { audit, calls } = makeAudit();
      const now = new Date('2026-06-30T00:00:00Z');

      const result = await new AdminInvitationService(
        inv.repo,
        users.repo,
        audit,
      ).accept({ token: 'plaintext-token', passwordHash: 'hashed-pw' }, now);

      expect(result).toEqual({ adminId: 'user-1' });
      expect(users.activated).toEqual([
        { id: 'user-1', passwordHash: 'hashed-pw', at: now },
      ]);
      expect(inv.accepted).toEqual([{ id: 'inv-1', at: now }]);
      expect(calls).toHaveLength(1);
      expect(calls[0].action).toBe('admin_update');
    });

    it('throws AdminInvitationInvalidError on an unknown token', async () => {
      const inv = makeInvRepo(null);
      const users = makeUserRepo();
      const { audit, calls } = makeAudit();

      await expect(
        new AdminInvitationService(inv.repo, users.repo, audit).accept(
          { token: 'nope', passwordHash: 'h' },
          new Date(),
        ),
      ).rejects.toBeInstanceOf(AdminInvitationInvalidError);
      expect(calls).toHaveLength(0);
    });

    it('throws AdminInvitationInvalidError when the invited user is missing', async () => {
      const active: ActiveAdminInvitationRecord = {
        id: 'inv-1',
        email: 'gone@b.co',
        roleId: 'role-1',
      };
      const inv = makeInvRepo(active);
      const users = makeUserRepo(null);
      const { audit } = makeAudit();

      await expect(
        new AdminInvitationService(inv.repo, users.repo, audit).accept(
          { token: 't', passwordHash: 'h' },
          new Date(),
        ),
      ).rejects.toBeInstanceOf(AdminInvitationInvalidError);
    });
  });
});
