import { describe, expect, it } from "vitest"
import { resolveStrategy } from "./sw-strategy"

const GET = (over: Partial<Parameters<typeof resolveStrategy>[0]> = {}) =>
  resolveStrategy({
    method: "GET",
    sameOrigin: true,
    pathname: "/",
    isNavigate: false,
    ...over,
  })

describe("resolveStrategy — the service worker's caching decision", () => {
  it("never intercepts non-GET requests", () => {
    expect(GET({ method: "POST", pathname: "/api/chat" })).toBe("passthrough")
  })

  it("never intercepts cross-origin requests (the API backend, CDNs)", () => {
    expect(GET({ sameOrigin: false, pathname: "/anything" })).toBe(
      "passthrough"
    )
  })

  it("goes network-only for same-origin /api — auth/chat/wallet are NEVER cached", () => {
    expect(GET({ pathname: "/api/auth/me" })).toBe("network-only")
    expect(GET({ pathname: "/api/chat/message" })).toBe("network-only")
  })

  it("serves navigations network-first (fresh shell, offline fallback)", () => {
    expect(GET({ isNavigate: true, pathname: "/dashboard" })).toBe(
      "network-first"
    )
  })

  it("serves hashed Next static assets cache-first", () => {
    expect(GET({ pathname: "/_next/static/chunks/main-abc123.js" })).toBe(
      "cache-first"
    )
  })

  it("serves our own icons and manifest cache-first", () => {
    expect(GET({ pathname: "/icons/icon-192.png" })).toBe("cache-first")
    expect(GET({ pathname: "/manifest.webmanifest" })).toBe("cache-first")
    expect(GET({ pathname: "/icon.svg" })).toBe("cache-first")
  })

  it("serves fonts and images cache-first by extension", () => {
    expect(GET({ pathname: "/fonts/inter.woff2" })).toBe("cache-first")
    expect(GET({ pathname: "/og/card.png" })).toBe("cache-first")
  })

  it("falls back to network-first for other same-origin GETs", () => {
    expect(GET({ pathname: "/some/page-data" })).toBe("network-first")
  })

  it("prioritises the /api guard over a static-looking extension", () => {
    // e.g. an API route that returns an image must still bypass the cache
    expect(GET({ pathname: "/api/receipt.png" })).toBe("network-only")
  })
})
