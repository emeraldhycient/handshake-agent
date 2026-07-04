import { resolve } from "node:path"
import type { NextConfig } from "next"

/**
 * Content-Security-Policy for the admin console.
 *
 * Strict by design: the operator surface is never embedded anywhere and calls
 * only its own API. `connect-src` allows same-origin plus the configured API
 * origin (`NEXT_PUBLIC_API_BASE_URL`) — when the API is same-origin proxied the
 * env var is unset and `'self'` suffices.
 *
 * Residual to tighten later: `'unsafe-inline'` (styles + scripts) and, in dev,
 * `'unsafe-eval'` are permitted because Next/React + Tailwind currently need
 * them; move to per-request nonces to drop `'unsafe-inline'` from script-src.
 */
function buildContentSecurityPolicy(): string {
  const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL
  const connectSrc = ["'self'", apiOrigin].filter(Boolean).join(" ")
  // Turbopack dev / HMR evaluates generated code — scope 'unsafe-eval' to dev only.
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? "'self' 'unsafe-inline'"
      : "'self' 'unsafe-inline' 'unsafe-eval'"

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    `connect-src ${connectSrc}`,
  ].join("; ")
}

/**
 * Baseline hardening headers applied to every route. Kept in one list so the
 * `headers()` rule below has a single source of truth.
 */
function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ]
}

const nextConfig: NextConfig = {
  // The shared contracts package is source-only (.ts) — Next must transpile it.
  transpilePackages: ["@handshake-agent/contracts"],
  // Pin file tracing to the monorepo root so Next traces files correctly and
  // stops warning about the multiple lockfiles it sees in a pnpm workspace.
  outputFileTracingRoot: resolve(__dirname, ".."),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }]
  },
}

export default nextConfig
