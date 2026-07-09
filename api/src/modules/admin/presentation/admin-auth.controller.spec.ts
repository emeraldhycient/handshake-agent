import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import type { AdminLoginResponse, AdminMe } from '@handshake-agent/contracts';

import { ADMIN_SESSION_COOKIE } from '../../../core/common/cookie-options';
import { AdminAuthController } from './admin-auth.controller';
import type { AdminAuthService } from '../application/admin-auth.service';
import type { AdminContext } from './current-admin.decorator';

// Dev config → cookie is HttpOnly + SameSite=Strict + NOT secure.
const config = { get: () => undefined } as unknown as ConfigService;

const ADMIN_ME: AdminMe = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'admin@x.io',
  displayName: 'Admin One',
  role: { id: '22222222-2222-2222-2222-222222222222', name: 'super_admin' },
  status: 'active',
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
};

const LOGIN_RESULT: AdminLoginResponse = {
  accessToken: 'admin.session.jwt',
  expiresAt: new Date('2030-01-01T00:00:00.000Z').toISOString(),
  admin: ADMIN_ME,
};

function makeRes(): jest.Mocked<Pick<Response, 'cookie' | 'clearCookie'>> {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
}

function makeController(auth: Partial<AdminAuthService>): AdminAuthController {
  // Only `auth` + `config` are exercised by login/logout; the remaining ctor deps
  // are irrelevant to these paths and are passed as undefined stubs.
  return new AdminAuthController(
    auth as AdminAuthService,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    config,
  );
}

describe('AdminAuthController.login — session cookie', () => {
  it('sets the HttpOnly SameSite=Strict ha_admin_session cookie and returns the body', async () => {
    const login = jest.fn().mockResolvedValue(LOGIN_RESULT);
    const controller = makeController({ login });
    const res = makeRes();
    const req = {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
    } as unknown as Request;

    const result = await controller.login(
      { email: 'admin@x.io', password: 'pw' },
      req,
      res as unknown as Response,
    );

    expect(login).toHaveBeenCalledWith(
      { email: 'admin@x.io', password: 'pw' },
      { ip: '127.0.0.1', userAgent: 'jest' },
    );
    expect(res.cookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE,
      'admin.session.jwt',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      }),
    );
    // Non-breaking: the body still carries the token, expiresAt, and admin.
    expect(result).toEqual(LOGIN_RESULT);
  });
});

describe('AdminAuthController.logout — clears the session cookie', () => {
  it('revokes the session and clears ha_admin_session', async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    const controller = makeController({ logout });
    const res = makeRes();
    const admin: AdminContext = {
      adminId: 'admin-1',
      sessionId: 'sess-1',
      roleId: 'role-1',
      email: 'admin@x.io',
    };

    await controller.logout(admin, res as unknown as Response);

    expect(logout).toHaveBeenCalledWith('sess-1');
    expect(res.clearCookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE,
      expect.objectContaining({ path: '/' }),
    );
  });
});
