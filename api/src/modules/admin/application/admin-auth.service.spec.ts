import {
  AdminInactiveError,
  AdminInvalidCredentialsError,
  AdminMfaInvalidError,
  AdminMfaRequiredError,
} from '../domain/admin-errors';
import { AdminAuthService } from './admin-auth.service';
import type { AdminMfaService } from './admin-mfa.service';
import type { AdminTokenService } from './admin-token.service';
import type { AuthorizationService } from './authorization.service';
import type { AuditService } from '../../../core/audit/application/audit.service';
import type {
  AdminSessionRecord,
  IAdminSessionRepository,
} from './ports/admin-session.repository.port';
import type {
  AdminUserRecord,
  IAdminUserRepository,
} from './ports/admin-user.repository.port';
import type { IPasswordHasher } from './ports/password-hasher.port';
import type { IRoleRepository } from './ports/role.repository.port';

type UserWithPassword = AdminUserRecord & { passwordHash: string };

const activeUser: UserWithPassword = {
  id: 'admin-1',
  email: 'admin@x.io',
  displayName: 'Admin One',
  status: 'active',
  mfaEnabled: false,
  mfaSecret: null,
  mfaRecoveryCodes: [],
  roleId: 'role-1',
  roleName: 'super_admin',
  createdAt: new Date('2026-01-01'),
  lastLoginAt: null,
  passwordHash: 'hashed:pw',
};

const session: AdminSessionRecord = {
  id: 'sess-1',
  adminUserId: 'admin-1',
  tokenHash: 'th',
  expiresAt: new Date('2030-01-01'),
  revokedAt: null,
  stepUpCompletedAt: null,
  ipAddress: null,
  userAgent: null,
};

function build(user: UserWithPassword | null = activeUser) {
  const userRepo = {
    findByEmail: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    recordLogin: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IAdminUserRepository>;

  const sessionRepo = {
    // Echo the service-supplied id so token.sub === session.id holds.
    create: jest
      .fn()
      .mockImplementation((input: { id?: string }) =>
        Promise.resolve({ ...session, id: input.id ?? session.id }),
      ),
    revoke: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(session),
  } as unknown as jest.Mocked<IAdminSessionRepository>;

  const hasher = {
    hash: jest.fn(),
    verify: jest.fn((hash: string, plain: string) =>
      Promise.resolve(hash === `hashed:${plain}`),
    ),
  } as unknown as jest.Mocked<IPasswordHasher>;

  const mfa = {
    verifyForLogin: jest.fn(),
  } as unknown as jest.Mocked<AdminMfaService>;

  const tokens = {
    sign: jest.fn().mockReturnValue({
      token: 'jwt-token',
      expiresAt: new Date('2030-01-01'),
    }),
    hash: jest.fn().mockReturnValue('token-hash'),
  } as unknown as jest.Mocked<AdminTokenService>;

  const authz = {
    meView: jest.fn().mockResolvedValue({
      permissions: ['api_route:GET /admin/audit:read'],
      menus: ['menu.audit'],
      pages: ['/admin/audit'],
    }),
  } as unknown as jest.Mocked<AuthorizationService>;

  const roleRepo = {
    findById: jest.fn().mockResolvedValue({
      id: 'role-1',
      name: 'compliance',
      description: '',
      isBuiltin: true,
      permissionIds: [],
    }),
  } as unknown as jest.Mocked<IRoleRepository>;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;

  const svc = new AdminAuthService(
    userRepo,
    sessionRepo,
    hasher,
    mfa,
    tokens,
    authz,
    roleRepo,
    audit,
  );
  return {
    svc,
    userRepo,
    sessionRepo,
    hasher,
    mfa,
    tokens,
    authz,
    roleRepo,
    audit,
  };
}

describe('AdminAuthService', () => {
  describe('login', () => {
    it('returns a token + session + admin for the right password (no MFA)', async () => {
      const { svc, sessionRepo, tokens, audit, userRepo } = build();
      const res = await svc.login(
        { email: 'admin@x.io', password: 'pw' },
        { ip: '1.2.3.4', userAgent: 'UA' },
      );

      expect(res.accessToken).toBe('jwt-token');
      expect(res.expiresAt).toBe(new Date('2030-01-01').toISOString());
      expect(res.admin.id).toBe('admin-1');
      expect(res.admin.email).toBe('admin@x.io');
      expect(res.admin.role).toEqual({ id: 'role-1', name: 'compliance' });
      expect(res.admin.permissions).toContain(
        'api_route:GET /admin/audit:read',
      );

      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: 'admin-1',
          tokenHash: 'token-hash',
          ipAddress: '1.2.3.4',
          userAgent: 'UA',
        }),
      );
      expect(userRepo.recordLogin).toHaveBeenCalledWith(
        'admin-1',
        expect.any(Date),
      );
      // The JWT is signed over the session id; the same id is persisted so the
      // guard can bind token.sub ⇄ session.id.
      const createCalls = (sessionRepo.create as jest.Mock).mock.calls as Array<
        [{ id: string }]
      >;
      expect(tokens.sign).toHaveBeenCalledWith(createCalls[0][0].id);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session_create',
          actorAdminId: 'admin-1',
        }),
      );
    });

    it('throws AdminInvalidCredentialsError on a wrong password', async () => {
      const { svc, sessionRepo } = build();
      await expect(
        svc.login({ email: 'admin@x.io', password: 'wrong' }, {}),
      ).rejects.toBeInstanceOf(AdminInvalidCredentialsError);
      expect(sessionRepo.create).not.toHaveBeenCalled();
    });

    it('throws AdminInvalidCredentialsError (with a dummy compare) for an unknown email', async () => {
      const { svc, hasher } = build(null);
      await expect(
        svc.login({ email: 'nobody@x.io', password: 'pw' }, {}),
      ).rejects.toBeInstanceOf(AdminInvalidCredentialsError);
      // Timing-safe: a dummy verify still runs even though the user is missing.
      expect(hasher.verify).toHaveBeenCalled();
    });

    it('throws AdminInactiveError when the admin is not active', async () => {
      const { svc } = build({ ...activeUser, status: 'suspended' });
      await expect(
        svc.login({ email: 'admin@x.io', password: 'pw' }, {}),
      ).rejects.toBeInstanceOf(AdminInactiveError);
    });

    it('throws AdminMfaRequiredError when MFA is enabled but no code is supplied', async () => {
      const { svc } = build({ ...activeUser, mfaEnabled: true });
      await expect(
        svc.login({ email: 'admin@x.io', password: 'pw' }, {}),
      ).rejects.toBeInstanceOf(AdminMfaRequiredError);
    });

    it('throws AdminMfaInvalidError when a supplied code does not verify', async () => {
      const { svc, mfa } = build({ ...activeUser, mfaEnabled: true });
      (mfa.verifyForLogin as jest.Mock).mockResolvedValue(false);
      await expect(
        svc.login({ email: 'admin@x.io', password: 'pw', totp: '000000' }, {}),
      ).rejects.toBeInstanceOf(AdminMfaInvalidError);
    });

    it('succeeds when MFA is enabled and a valid TOTP is supplied', async () => {
      const { svc, mfa, sessionRepo } = build({
        ...activeUser,
        mfaEnabled: true,
      });
      (mfa.verifyForLogin as jest.Mock).mockResolvedValue(true);
      const res = await svc.login(
        { email: 'admin@x.io', password: 'pw', totp: '123456' },
        {},
      );
      expect(res.accessToken).toBe('jwt-token');
      expect(sessionRepo.create).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the session and audits a session_revoke', async () => {
      const { svc, sessionRepo, audit } = build();
      await svc.logout('sess-1');
      expect(sessionRepo.revoke).toHaveBeenCalledWith(
        'sess-1',
        expect.any(Date),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'session_revoke' }),
      );
    });
  });

  describe('me', () => {
    it('assembles the AdminMe view for an admin', async () => {
      const { svc } = build();
      const me = await svc.me('admin-1');
      expect(me).toEqual({
        id: 'admin-1',
        email: 'admin@x.io',
        displayName: 'Admin One',
        role: { id: 'role-1', name: 'compliance' },
        status: 'active',
        mfaEnabled: false,
        permissions: ['api_route:GET /admin/audit:read'],
        menus: ['menu.audit'],
        pages: ['/admin/audit'],
      });
    });

    it('falls back to the email local-part when displayName is blank', async () => {
      const { svc, userRepo } = build();
      (userRepo.findById as jest.Mock).mockResolvedValue({
        ...activeUser,
        displayName: '',
      });
      const me = await svc.me('admin-1');
      expect(me.displayName).toBe('admin');
    });
  });
});
