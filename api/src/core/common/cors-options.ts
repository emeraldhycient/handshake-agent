import type { ConfigService } from '@nestjs/config';

/**
 * CORS origin allowlist for the credentialed browser surfaces (Wave H).
 *
 * With `credentials: true` (required so the browser sends/stores the HttpOnly
 * auth cookies), the reflected origin must be an EXACT allowlist — never `*`
 * (the spec forbids `*` with credentials, and a wildcard would let any site
 * drive authenticated requests). The list is the web app + the web-admin console
 * origins. In dev both default to `http://localhost:3000` (the web-admin
 * visual-verify runbook runs the console on :3000 against the api on :3001).
 */

const DEV_ORIGIN = 'http://localhost:3000';

/**
 * Additional exact origins beyond the two canonical ones, as a comma-separated
 * list. Exists because a surface can be reachable at more than one hostname —
 * e.g. during a custom-domain cutover, where the platform subdomain must keep
 * working while `WEB_APP_BASE_URL` already names the real domain (that variable
 * is not CORS-only: it also builds the KYC handoff and email-verification
 * links, so it must be the canonical public URL).
 *
 * Blank segments are dropped and `*` is rejected outright — a wildcard is
 * invalid with `credentials: true` and would defeat the allowlist.
 */
function parseExtraOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '' && origin !== '*');
}

/** The exact, de-duplicated list of browser origins allowed to send credentials. */
export function buildAllowedOrigins(config: ConfigService): string[] {
  const web = config.get<string>('WEB_APP_BASE_URL') ?? DEV_ORIGIN;
  const admin = config.get<string>('ADMIN_APP_BASE_URL') ?? DEV_ORIGIN;
  const extra = parseExtraOrigins(config.get<string>('CORS_EXTRA_ORIGINS'));
  // De-dupe: web + admin collapse to one origin in dev, and may share a domain in prod.
  return Array.from(new Set([web, admin, ...extra]));
}
