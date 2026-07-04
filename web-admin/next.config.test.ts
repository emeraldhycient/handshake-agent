/**
 * Security-headers regression test for the admin console.
 *
 * The admin surface is the privileged operator console; it must ship a strict
 * set of HTTP security headers on every route (clickjacking / MIME-sniffing /
 * referrer / transport / CSP). This test pins the posture so a future edit to
 * next.config.ts cannot silently drop a header (§3.3 — the FE gate is defence
 * in depth, never the only check).
 */
import { describe, it, expect } from "vitest"

import nextConfig from "./next.config"

async function getRootHeaders() {
  const rules = await nextConfig.headers!()
  const rule = rules.find((r) => r.source === "/:path*")
  expect(rule).toBeDefined()
  return new Map(rule!.headers.map((h) => [h.key, h.value]))
}

describe("web-admin security headers", () => {
  it("applies the baseline headers to every route", async () => {
    const headers = await getRootHeaders()

    expect(headers.get("X-Frame-Options")).toBe("DENY")
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    )
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()"
    )
  })

  it("ships a strict Content-Security-Policy with frame-ancestors 'none'", async () => {
    const headers = await getRootHeaders()
    const csp = headers.get("Content-Security-Policy")

    expect(csp).toBeDefined()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    // connect-src must at least allow same-origin XHR/fetch.
    expect(csp).toContain("connect-src 'self'")
  })

  it("includes the configured API origin in connect-src when set", async () => {
    const prev = process.env.NEXT_PUBLIC_API_BASE_URL
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com"
    try {
      const headers = await getRootHeaders()
      const csp = headers.get("Content-Security-Policy")
      expect(csp).toContain("https://api.example.com")
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL
      else process.env.NEXT_PUBLIC_API_BASE_URL = prev
    }
  })
})
