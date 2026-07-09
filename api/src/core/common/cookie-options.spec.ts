import type { ConfigService } from '@nestjs/config';

import {
  ADMIN_SESSION_COOKIE,
  WEB_REFRESH_COOKIE,
  adminSessionCookieOptions,
  webRefreshCookieOptions,
} from './cookie-options';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('cookie-options', () => {
  it('names the cookies for each surface', () => {
    expect(WEB_REFRESH_COOKIE).toBe('ha_refresh');
    expect(ADMIN_SESSION_COOKIE).toBe('ha_admin_session');
  });

  describe('webRefreshCookieOptions', () => {
    it('defaults to HttpOnly + SameSite=Lax + path=/ and NOT secure in dev', () => {
      const opts = webRefreshCookieOptions(makeConfig({}));
      expect(opts).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      });
    });

    it('is secure in production', () => {
      const opts = webRefreshCookieOptions(
        makeConfig({ NODE_ENV: 'production' }),
      );
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('lax');
    });
  });

  describe('adminSessionCookieOptions', () => {
    it('defaults to HttpOnly + SameSite=Strict + path=/ and NOT secure in dev', () => {
      const opts = adminSessionCookieOptions(makeConfig({}));
      expect(opts).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
      });
    });

    it('is secure in production', () => {
      const opts = adminSessionCookieOptions(
        makeConfig({ NODE_ENV: 'production' }),
      );
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('strict');
    });
  });

  describe('overrides', () => {
    it('AUTH_COOKIE_SAMESITE overrides the web refresh cookie default', () => {
      expect(
        webRefreshCookieOptions(makeConfig({ AUTH_COOKIE_SAMESITE: 'strict' }))
          .sameSite,
      ).toBe('strict');
    });

    it('ADMIN_COOKIE_SAMESITE overrides the admin session cookie default', () => {
      expect(
        adminSessionCookieOptions(makeConfig({ ADMIN_COOKIE_SAMESITE: 'lax' }))
          .sameSite,
      ).toBe('lax');
    });

    // CSRF regression (Wave H auth review, medium). The web cookie's SameSite knob
    // must NOT bleed into the admin cookie: a documented cross-registrable-domain
    // web deploy sets AUTH_COOKIE_SAMESITE=none for ha_refresh, and the admin
    // cookie must stay Strict so the cookie-authenticated, non-step-up admin writes
    // (e.g. POST /admin/users/:id/notes) remain CSRF-safe. The two knobs are
    // independent; neither cookie is affected by the other's env var.
    it('AUTH_COOKIE_SAMESITE=none does NOT downgrade the admin cookie (stays Strict)', () => {
      expect(
        adminSessionCookieOptions(makeConfig({ AUTH_COOKIE_SAMESITE: 'none' }))
          .sameSite,
      ).toBe('strict');
    });

    it('ADMIN_COOKIE_SAMESITE=none does NOT affect the web refresh cookie (stays Lax)', () => {
      expect(
        webRefreshCookieOptions(makeConfig({ ADMIN_COOKIE_SAMESITE: 'none' }))
          .sameSite,
      ).toBe('lax');
    });

    it('ADMIN_COOKIE_SAMESITE=none forces Secure on the admin cookie', () => {
      const opts = adminSessionCookieOptions(
        makeConfig({
          ADMIN_COOKIE_SAMESITE: 'none',
          AUTH_COOKIE_SECURE: 'false',
        }),
      );
      expect(opts.sameSite).toBe('none');
      expect(opts.secure).toBe(true);
    });

    it('AUTH_COOKIE_SECURE=true forces secure even outside production', () => {
      expect(
        webRefreshCookieOptions(makeConfig({ AUTH_COOKIE_SECURE: 'true' }))
          .secure,
      ).toBe(true);
    });

    it('AUTH_COOKIE_SECURE=false keeps secure off even in production', () => {
      expect(
        webRefreshCookieOptions(
          makeConfig({
            NODE_ENV: 'production',
            AUTH_COOKIE_SECURE: 'false',
          }),
        ).secure,
      ).toBe(false);
    });

    it('SameSite=None forces Secure on (browsers reject a non-secure None cookie), even with an explicit secure=false', () => {
      const opts = webRefreshCookieOptions(
        makeConfig({
          AUTH_COOKIE_SAMESITE: 'none',
          AUTH_COOKIE_SECURE: 'false',
        }),
      );
      expect(opts.sameSite).toBe('none');
      expect(opts.secure).toBe(true);
    });
  });
});
