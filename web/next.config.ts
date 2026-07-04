import type { NextConfig } from "next"

/**
 * Baseline hardening headers applied to every route.
 *
 * Unlike the admin console, the user web app renders varied content (chat,
 * media) so it deliberately ships NO strict CSP — a restrictive policy here is
 * riskier and the CSP finding for this app was not confirmed. Clickjacking is
 * covered by `X-Frame-Options: DENY` plus a conservative `frame-ancestors
 * 'none'` (the modern equivalent, honoured by browsers that ignore XFO).
 */
const securityHeaders: { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Conservative CSP: block framing only — no default-src/script-src that could
  // break the varied user-facing content.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
]

const nextConfig: NextConfig = {
  // The shared contracts package is source-only (.ts) — Next must transpile it.
  transpilePackages: ["@handshake-agent/contracts"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
