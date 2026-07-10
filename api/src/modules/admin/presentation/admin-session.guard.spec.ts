import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { ADMIN_SESSION_COOKIE } from '../../../core/common/cookie-options';
import { AdminInvalidCredentialsError } from '../domain/admin-errors';
import { AdminSessionGuard } from './admin-session.guard';
import type { AdminContext } from './current-admin.decorator';
import type { AdminTokenService } from '../application/admin-token.service';
import type {
  AdminSessionRecord,
  IAdminSessionRepository,
} from '../application/ports/admin-session.repository.port';
import type {
  AdminUserRecord,
  IAdminUserRepository,
} from '../application/ports/admin-user.repository.port';

const session: AdminSessionRecord = {
  id: 'sess-1',
  adminUserId: 'admin-1',
  tokenHash: 'token-hash',
  expiresAt: new Date('2030-01-01'),
  revokedAt: null,
  stepUpCompletedAt: null,
  ipAddress: null,
  userAgent: null,
};

const user: AdminUserRecord = {
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
};

function ctxWith(
  authorization: string | undefined,
  cookies?: Record<string, string | undefined>,
): {
  ctx: ExecutionContext;
  req: {
    headers: Record<string, string | undefined>;
    cookies?: Record<string, string | undefined>;
    admin?: AdminContext;
  };
} {
  const req = {
    headers: { authorization },
    cookies,
    admin: undefined as AdminContext | undefined,
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function build(
  opts: {
    verify?: () => { sessionId: string };
    activeSession?: AdminSessionRecord | null;
    adminUser?: AdminUserRecord | null;
  } = {},
) {
  const tokens = {
    verify: jest.fn(opts.verify ?? (() => ({ sessionId: 'sess-1' }))),
    hash: jest.fn().mockReturnValue('token-hash'),
  } as unknown as jest.Mocked<AdminTokenService>;

  const sessionRepo = {
    findActiveByTokenHash: jest
      .fn()
      .mockResolvedValue(
        opts.activeSession === undefined ? session : opts.activeSession,
      ),
  } as unknown as jest.Mocked<IAdminSessionRepository>;

  const userRepo = {
    findById: jest
      .fn()
      .mockResolvedValue(opts.adminUser === undefined ? user : opts.adminUser),
  } as unknown as jest.Mocked<IAdminUserRepository>;

  return {
    guard: new AdminSessionGuard(tokens, sessionRepo, userRepo),
    tokens,
    sessionRepo,
    userRepo,
  };
}

describe('AdminSessionGuard', () => {
  it('throws Unauthorized when neither a cookie nor a Bearer header is present', async () => {
    const { guard } = build();
    const { ctx } = ctxWith(undefined, undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when the header is not a Bearer token', async () => {
    const { guard } = build();
    const { ctx } = ctxWith('Basic abc');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when the token fails to verify', async () => {
    const { guard } = build({
      verify: () => {
        throw new AdminInvalidCredentialsError();
      },
    });
    const { ctx } = ctxWith('Bearer bad-token');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when no active session matches the token hash', async () => {
    const { guard } = build({ activeSession: null });
    const { ctx } = ctxWith('Bearer t');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when the session id does not match the token subject', async () => {
    const { guard } = build({ verify: () => ({ sessionId: 'other' }) });
    const { ctx } = ctxWith('Bearer t');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when the admin user is not active', async () => {
    const { guard } = build({ adminUser: { ...user, status: 'suspended' } });
    const { ctx } = ctxWith('Bearer t');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when the admin user is gone', async () => {
    const { guard } = build({ adminUser: null });
    const { ctx } = ctxWith('Bearer t');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('sets req.admin and returns true for a valid Bearer header token', async () => {
    const { guard } = build();
    const { ctx, req } = ctxWith('Bearer good-token');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.admin).toEqual({
      adminId: 'admin-1',
      sessionId: 'sess-1',
      roleId: 'role-1',
      email: 'admin@x.io',
    });
  });

  it('accepts the token from the ha_admin_session cookie (no header present)', async () => {
    const { guard, tokens } = build();
    const { ctx, req } = ctxWith(undefined, {
      [ADMIN_SESSION_COOKIE]: 'cookie-jwt',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(tokens.verify).toHaveBeenCalledWith('cookie-jwt');
    expect(req.admin?.adminId).toBe('admin-1');
  });

  it('prefers the cookie over the Authorization header when both are present', async () => {
    const { guard, tokens } = build();
    const { ctx } = ctxWith('Bearer header-jwt', {
      [ADMIN_SESSION_COOKIE]: 'cookie-jwt',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(tokens.verify).toHaveBeenCalledWith('cookie-jwt');
  });
});
