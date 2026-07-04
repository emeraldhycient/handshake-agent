/**
 * Security-headers regression test for the user web app.
 *
 * The user surface renders varied content (chat, media) so it ships the
 * baseline hardening headers without a strict CSP that could break rendering;
 * clickjacking is covered by X-Frame-Options plus a conservative
 * `frame-ancestors 'none'`. This test pins that posture so a future edit to
 * next.config.ts cannot silently drop a header.
 */
import { describe, it, expect } from "vitest"

import nextConfig from "./next.config"

async function getRootHeaders() {
  const rules = await nextConfig.headers!()
  const rule = rules.find((r) => r.source === "/:path*")
  expect(rule).toBeDefined()
  return new Map(rule!.headers.map((h) => [h.key, h.value]))
}

describe("web security headers", () => {
  it("applies the baseline headers to every route", async () => {
    const headers = await getRootHeaders()

    expect(headers.get("X-Frame-Options")).toBe("DENY")
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    )
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    )
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()"
    )
  })

  it("blocks framing via a conservative frame-ancestors CSP (no strict CSP)", async () => {
    const headers = await getRootHeaders()
    const csp = headers.get("Content-Security-Policy")

    expect(csp).toBe("frame-ancestors 'none'")
  })
})
