import type { ConfigService } from '@nestjs/config';

import {
  AdminAccountLockedError,
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

const MAX_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;

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
  failedLoginCount: 0,
  loginLockedUntil: null,
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

/**
 * Build the service under test with a fake IAdminUserRepository whose
 * `registerFailedLogin` is a REAL atomic operation: it folds the expired-window
 * reset INTO the increment and mutates the fake user in place, mirroring the
 * DB-side single-statement UPDATE. The concurrency tests rely on this so at most
 * `maxAttempts` callers ever pass the pre-verify gate — a non-atomic service
 * (or a separate reset-then-increment on an expired window) fails them.
 */
function build(user: UserWithPassword | null = activeUser) {
  // A mutable copy so the atomic counter/lock writes are observable across calls.
  const state = user ? { ...user } : null;

  const setLoginLock = jest.fn((_id: string, until: Date) => {
    if (state) state.loginLockedUntil = until;
    return Promise.resolve();
  });
  const resetLoginFailures = jest.fn(() => {
    if (state) {
      state.failedLoginCount = 0;
      state.loginLockedUntil = null;
    }
    return Promise.resolve();
  });
  const registerFailedLogin = jest.fn((_id: string, now: Date) => {
    if (!state) return Promise.resolve({ count: 0, lockedUntil: null });
    let count: number;
    let lockedUntil: Date | null;
    if (state.loginLockedUntil && state.loginLockedUntil > now) {
      // Active lock: leave the counter untouched.
      count = state.failedLoginCount;
      lockedUntil = state.loginLockedUntil;
    } else if (state.loginLockedUntil && state.loginLockedUntil <= now) {
      // Expired window: start a fresh window at 1 and clear the lock.
      count = 1;
      lockedUntil = null;
    } else {
      count = state.failedLoginCount + 1;
      lockedUntil = null;
    }
    state.failedLoginCount = count;
    state.loginLockedUntil = lockedUntil;
    return Promise.resolve({ count, lockedUntil });
  });

  const userRepo = {
    // findByEmail returns a SNAPSHOT copy taken after a microtask hop — modelling
    // a real DB round-trip. Concurrent callers therefore all read the SAME
    // pre-increment snapshot (none sees another's not-yet-persisted increment or
    // lock). This is what makes the concurrency test discriminate: only the
    // atomic `registerFailedLogin` return can cap the burst, since the snapshot
    // count is stale. A non-atomic service (deciding from the snapshot count)
    // lets every concurrent attempt through and fails the test.
    findByEmail: jest.fn(async () => {
      if (!state) return null;
      await Promise.resolve();
      return { ...state };
    }),
    findById: jest.fn(() => Promise.resolve(state)),
    recordLogin: jest.fn().mockResolvedValue(undefined),
    registerFailedLogin,
    setLoginLock,
    resetLoginFailures,
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

  const config = {
    get: jest.fn((key: string) => {
      if (key === 'admin.login.maxAttempts') return MAX_ATTEMPTS;
      if (key === 'admin.login.lockoutMinutes') return LOCKOUT_MINUTES;
      return undefined;
    }),
  } as unknown as jest.Mocked<ConfigService>;

  const svc = new AdminAuthService(
    userRepo,
    sessionRepo,
    hasher,
    mfa,
    tokens,
    authz,
    roleRepo,
    audit,
    config,
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
    config,
    state,
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
      const { svc, hasher, userRepo } = build(null);
      await expect(
        svc.login({ email: 'nobody@x.io', password: 'pw' }, {}),
      ).rejects.toBeInstanceOf(AdminInvalidCredentialsError);
      // Timing-safe: a dummy verify still runs even though the user is missing.
      expect(hasher.verify).toHaveBeenCalled();
      // No account to lock → never register a failure for a null user.
      expect(userRepo.registerFailedLogin).not.toHaveBeenCalled();
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

  describe('per-account failure lockout (§3.3 / §3.4)', () => {
    it('atomically registers the failure BEFORE verifying a known account', async () => {
      const { svc, userRepo, hasher } = build();
      const incrementOrder: number[] = [];
      (userRepo.registerFailedLogin as jest.Mock).mockImplementation(() => {
        incrementOrder.push(1);
        return Promise.resolve({ count: 1, lockedUntil: null });
      });
      (hasher.verify as jest.Mock).mockImplementation(() => {
        incrementOrder.push(2);
        return Promise.resolve(false);
      });
      await expect(
        svc.login({ email: 'admin@x.io', password: 'wrong' }, {}),
      ).rejects.toBeInstanceOf(AdminInvalidCredentialsError);
      // Increment (1) precedes the argon2 verify (2): brute-force TOCTOU guard.
      expect(incrementOrder).toEqual([1, 2]);
    });

    it('locks the account after maxAttempts failed logins and rejects further attempts even with the correct password', async () => {
      const { svc, userRepo } = build();

      // maxAttempts wrong-password attempts → the last one locks the account.
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        await expect(
          svc.login({ email: 'admin@x.io', password: 'wrong' }, {}),
        ).rejects.toBeInstanceOf(AdminInvalidCredentialsError);
      }
      expect(userRepo.setLoginLock).toHaveBeenCalledWith(
        'admin-1',
        expect.any(Date),
      );

      // Now locked: even the CORRECT password is rejected as locked, and the
      // expensive verify is short-circuited (no further register/verify).
      (userRepo.registerFailedLogin as jest.Mock).mockClear();
      await expect(
        svc.login({ email: 'admin@x.io', password: 'pw' }, {}),
      ).rejects.toBeInstanceOf(AdminAccountLockedError);
      expect(userRepo.registerFailedLogin).not.toHaveBeenCalled();
    });

    it('counts a failed MFA code toward the lockout (increment already ran pre-verify)', async () => {
      const { svc, userRepo, mfa } = build({ ...activeUser, mfaEnabled: true });
      (mfa.verifyForLogin as jest.Mock).mockResolvedValue(false);
      await expect(
        svc.login({ email: 'admin@x.io', password: 'pw', totp: '000000' }, {}),
      ).rejects.toBeInstanceOf(AdminMfaInvalidError);
      expect(userRepo.registerFailedLogin).toHaveBeenCalledWith(
        'admin-1',
        expect.any(Date),
      );
    });

    it('resets the failure counter on a fully successful login', async () => {
      const { svc, userRepo } = build({ ...activeUser, failedLoginCount: 3 });
      await svc.login({ email: 'admin@x.io', password: 'pw' }, {});
      expect(userRepo.resetLoginFailures).toHaveBeenCalledWith('admin-1');
    });

    it('does NOT consume an attempt or lock for a correct-password inactive account (status guard is not a login failure)', async () => {
      const { svc, userRepo, state } = build({
        ...activeUser,
        status: 'suspended',
      });
      await expect(
        svc.login({ email: 'admin@x.io', password: 'pw' }, {}),
      ).rejects.toBeInstanceOf(AdminInactiveError);
      // The correct password proves the legitimate owner: the atomic pre-verify
      // increment is redeemed (net counter back to 0) and the account is NOT
      // locked — a suspended account never accrues a spurious lockout.
      expect(userRepo.resetLoginFailures).toHaveBeenCalledWith('admin-1');
      expect(userRepo.setLoginLock).not.toHaveBeenCalled();
      expect(state?.failedLoginCount).toBe(0);
      expect(state?.loginLockedUntil).toBeNull();
    });

    it('caps a concurrent burst: at most maxAttempts reach the verify and the account ends locked (atomic)', async () => {
      const { svc, userRepo, hasher, state } = build();
      const BURST = 20;

      // Count how many attempts actually reach the argon2 verify. With the atomic
      // pre-verify increment, only the first maxAttempts can pass the gate; the
      // rest overflow the counter and are short-circuited to a lock without
      // verifying. A non-atomic implementation would let all 20 through → fails.
      let verifyCalls = 0;
      (hasher.verify as jest.Mock).mockImplementation(() => {
        verifyCalls += 1;
        return Promise.resolve(false);
      });

      const results = await Promise.allSettled(
        Array.from({ length: BURST }, () =>
          svc.login({ email: 'admin@x.io', password: 'wrong' }, {}),
        ),
      );

      // Every attempt rejects (all wrong password).
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      // The verify is reached at most maxAttempts times — the atomic increment
      // caps concurrent comparisons.
      expect(verifyCalls).toBeLessThanOrEqual(MAX_ATTEMPTS);
      // The account is locked and setLoginLock was called.
      expect(userRepo.setLoginLock).toHaveBeenCalled();
      expect(state?.loginLockedUntil).toBeInstanceOf(Date);
    });

    it('caps a concurrent burst on a just-EXPIRED lock window at maxAttempts (atomic register)', async () => {
      // Attacker-inducible state: the account hit the cap and the lockout window
      // has elapsed (loginLockedUntil in the PAST, counter still at maxAttempts).
      // A separate reset-then-increment would let a concurrent burst interleave
      // the reset and keep every attempt under the cap — the same TOCTOU the
      // fold-in register closes. Mirrors the PinService expired-window regression.
      const { svc, userRepo, hasher, state } = build({
        ...activeUser,
        failedLoginCount: MAX_ATTEMPTS,
        loginLockedUntil: new Date(Date.now() - 60_000),
      });

      let verifyCalls = 0;
      (hasher.verify as jest.Mock).mockImplementation(() => {
        verifyCalls += 1;
        return Promise.resolve(false);
      });

      const BURST = 20;
      const results = await Promise.allSettled(
        Array.from({ length: BURST }, () =>
          svc.login({ email: 'admin@x.io', password: 'wrong' }, {}),
        ),
      );

      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      // The fresh window still caps comparisons — the expired-window reset did NOT
      // reopen the bypass.
      expect(verifyCalls).toBeLessThanOrEqual(MAX_ATTEMPTS);
      expect(userRepo.setLoginLock).toHaveBeenCalled();
      expect(state?.loginLockedUntil).toBeInstanceOf(Date);
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
