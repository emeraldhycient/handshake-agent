import {
  AdminInvalidCredentialsError,
  AdminStepUpRequiredError,
} from '../domain/admin-errors';
import { AdminStepUpService } from './admin-step-up.service';
import type { AdminMfaService } from './admin-mfa.service';
import type {
  AdminSessionRecord,
  IAdminSessionRepository,
} from './ports/admin-session.repository.port';
import type {
  AdminUserRecord,
  IAdminUserRepository,
} from './ports/admin-user.repository.port';
import type { IPasswordHasher } from './ports/password-hasher.port';
import type { Env } from '../../../core/config/env.schema';

const TTL = 300;

const userBase: AdminUserRecord = {
  id: 'admin-1',
  email: 'admin@x.io',
  status: 'active',
  mfaEnabled: false,
  mfaSecret: null,
  mfaRecoveryCodes: [],
  roleId: 'role-1',
  roleName: 'super_admin',
  createdAt: new Date('2026-01-01'),
  lastLoginAt: null,
};

function build(session: AdminSessionRecord | null, passwordHash = 'hashed:pw') {
  const sessionRepo = {
    create: jest.fn(),
    findActiveByTokenHash: jest.fn(),
    revoke: jest.fn(),
    recordStepUp: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(session),
    listForAdmin: jest.fn(),
    revokeAllForAdmin: jest.fn(),
  } as unknown as jest.Mocked<IAdminSessionRepository>;

  const userRepo = {
    findById: jest.fn().mockResolvedValue({ ...userBase, passwordHash }),
  } as unknown as jest.Mocked<IAdminUserRepository> & {
    findById: jest.Mock;
  };
  // The hasher compares against a (test-only) passwordHash field on the record.
  (userRepo.findById as jest.Mock).mockResolvedValue({
    ...userBase,
    passwordHash,
  });

  const hasher = {
    hash: jest.fn(),
    verify: jest.fn((hash: string, plain: string) =>
      Promise.resolve(hash === `hashed:${plain}`),
    ),
  } as unknown as jest.Mocked<IPasswordHasher>;

  const mfa = {
    verifyForLogin: jest.fn(),
  } as unknown as jest.Mocked<AdminMfaService>;

  const config = {
    get: (key: keyof Env) =>
      key === 'ADMIN_STEP_UP_TTL_SECONDS' ? TTL : undefined,
  };

  const svc = new AdminStepUpService(
    sessionRepo,
    userRepo,
    hasher,
    mfa,
    config as never,
  );
  return { svc, sessionRepo, userRepo, hasher, mfa };
}

function session(over: Partial<AdminSessionRecord> = {}): AdminSessionRecord {
  return {
    id: 'sess-1',
    adminUserId: 'admin-1',
    tokenHash: 'th',
    expiresAt: new Date('2030-01-01'),
    revokedAt: null,
    stepUpCompletedAt: null,
    ipAddress: null,
    userAgent: null,
    ...over,
  };
}

describe('AdminStepUpService', () => {
  describe('challenge', () => {
    const now = new Date('2026-06-30T12:00:00Z');

    it('records the step-up when the password is correct', async () => {
      const { svc, sessionRepo } = build(session());
      await svc.challenge(
        { adminId: 'admin-1', sessionId: 'sess-1', password: 'pw' },
        now,
      );
      expect(sessionRepo.recordStepUp).toHaveBeenCalledWith('sess-1', now);
    });

    it('throws AdminInvalidCredentialsError for a wrong password', async () => {
      const { svc, sessionRepo } = build(session());
      await expect(
        svc.challenge(
          { adminId: 'admin-1', sessionId: 'sess-1', password: 'wrong' },
          now,
        ),
      ).rejects.toBeInstanceOf(AdminInvalidCredentialsError);
      expect(sessionRepo.recordStepUp).not.toHaveBeenCalled();
    });

    it('records the step-up when a valid TOTP verifies', async () => {
      const { svc, sessionRepo, mfa } = build(session());
      (mfa.verifyForLogin as jest.Mock).mockResolvedValue(true);
      await svc.challenge(
        { adminId: 'admin-1', sessionId: 'sess-1', totp: '123456' },
        now,
      );
      expect(sessionRepo.recordStepUp).toHaveBeenCalledWith('sess-1', now);
    });

    it('throws when neither password nor totp verifies', async () => {
      const { svc, mfa } = build(session());
      (mfa.verifyForLogin as jest.Mock).mockResolvedValue(false);
      await expect(
        svc.challenge(
          { adminId: 'admin-1', sessionId: 'sess-1', totp: '000000' },
          now,
        ),
      ).rejects.toBeInstanceOf(AdminInvalidCredentialsError);
    });
  });

  describe('assertFresh', () => {
    it('passes when step-up is within the TTL window', async () => {
      const now = new Date('2026-06-30T12:00:00Z');
      const fresh = new Date(now.getTime() - (TTL - 10) * 1000);
      const { svc } = build(session({ stepUpCompletedAt: fresh }));
      await expect(svc.assertFresh('sess-1', now)).resolves.toBeUndefined();
    });

    it('throws AdminStepUpRequiredError when step-up is stale', async () => {
      const now = new Date('2026-06-30T12:00:00Z');
      const stale = new Date(now.getTime() - (TTL + 1) * 1000);
      const { svc } = build(session({ stepUpCompletedAt: stale }));
      await expect(svc.assertFresh('sess-1', now)).rejects.toBeInstanceOf(
        AdminStepUpRequiredError,
      );
    });

    it('throws when no step-up was ever recorded', async () => {
      const now = new Date('2026-06-30T12:00:00Z');
      const { svc } = build(session({ stepUpCompletedAt: null }));
      await expect(svc.assertFresh('sess-1', now)).rejects.toBeInstanceOf(
        AdminStepUpRequiredError,
      );
    });

    it('throws when the session does not exist', async () => {
      const now = new Date('2026-06-30T12:00:00Z');
      const { svc } = build(null);
      await expect(svc.assertFresh('sess-1', now)).rejects.toBeInstanceOf(
        AdminStepUpRequiredError,
      );
    });
  });
});
