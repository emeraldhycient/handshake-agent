import type { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';

/**
 * HttpOnly-cookie plumbing for the auth surfaces (Wave H, R1).
 *
 * The web user's rotating REFRESH token and the web-admin SESSION JWT move out of
 * browser JS storage (localStorage / sessionStorage) into HttpOnly cookies so a
 * script (XSS) can no longer read them. The ACCESS token and every Bearer flow
 * (JwtAuthGuard, PAT) are untouched — only these two long-lived credentials move.
 *
 * Attributes:
 *  - `httpOnly` always true (JS can never read the value).
 *  - `secure` true in production; false in dev so localhost:3000 ↔ :3001 works.
 *  - `sameSite` defaults per-cookie: 'lax' for the web refresh cookie (the app may
 *    be linked to), 'strict' for the admin session cookie (the console is never
 *    linked externally, so Strict blocks CSRF on cookie-authenticated admin calls).
 *
 * `sameSite` is overridable via a SEPARATE env knob per cookie so a cross-site
 * deploy of ONE surface can never silently weaken the other: `AUTH_COOKIE_SAMESITE`
 * governs only the web refresh cookie, `ADMIN_COOKIE_SAMESITE` only the admin session
 * cookie. (A single shared knob would let a cross-domain WEB deploy set `None` and
 * silently downgrade the admin cookie from Strict to None — re-opening CSRF on the
 * cookie-authenticated, non-step-up admin writes. The knobs are independent.)
 * `secure` is overridable via the shared `AUTH_COOKIE_SECURE`. A cross-registrable-
 * domain deploy — where the API sits on a different site than an app — switches that
 * app's cookie to `SameSite=None` + `Secure` (the only combination browsers send
 * cross-site). A `None` cookie is invalid without `Secure`, so we force `secure` on
 * whenever `sameSite==='none'`.
 */

/** HttpOnly cookie carrying the web user's rotating refresh token. */
export const WEB_REFRESH_COOKIE = 'ha_refresh';
/** HttpOnly cookie carrying the web-admin session JWT. */
export const ADMIN_SESSION_COOKIE = 'ha_admin_session';

type SameSite = 'lax' | 'strict' | 'none';

interface CookieShape {
  /** SameSite used when this cookie's own SameSite env knob is unset. */
  sameSiteDefault: SameSite;
  /** Env var that overrides `sameSiteDefault` for THIS cookie only. */
  sameSiteEnvKey: 'AUTH_COOKIE_SAMESITE' | 'ADMIN_COOKIE_SAMESITE';
  /** Cookie path (both cookies are root-scoped). */
  path: string;
}

function resolve(config: ConfigService, shape: CookieShape): CookieOptions {
  const isProd = config.get<string>('NODE_ENV') === 'production';

  const sameSiteOverride = config.get<string>(shape.sameSiteEnvKey);
  const sameSite: SameSite =
    (sameSiteOverride as SameSite | undefined) ?? shape.sameSiteDefault;

  const secureOverride = config.get<string>('AUTH_COOKIE_SECURE');
  let secure =
    secureOverride === 'true'
      ? true
      : secureOverride === 'false'
        ? false
        : isProd;
  // Browsers reject a SameSite=None cookie that is not Secure — force it so a
  // cross-site deploy can never silently ship a dropped (uncredentialed) cookie.
  if (sameSite === 'none') secure = true;

  return { httpOnly: true, secure, sameSite, path: shape.path };
}

/** Cookie options for the web refresh cookie (`ha_refresh`, SameSite=Lax, path=/). */
export function webRefreshCookieOptions(config: ConfigService): CookieOptions {
  return resolve(config, {
    sameSiteDefault: 'lax',
    sameSiteEnvKey: 'AUTH_COOKIE_SAMESITE',
    path: '/',
  });
}

/** Cookie options for the admin session cookie (`ha_admin_session`, SameSite=Strict, path=/). */
export function adminSessionCookieOptions(
  config: ConfigService,
): CookieOptions {
  return resolve(config, {
    sameSiteDefault: 'strict',
    sameSiteEnvKey: 'ADMIN_COOKIE_SAMESITE',
    path: '/',
  });
}
