import { describe, it, expect } from "vitest"
import { parseUserAgent } from "./user-agent"

describe("parseUserAgent", () => {
  it("detects Chrome on macOS (desktop)", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    expect(parseUserAgent(ua)).toEqual({
      browser: "Chrome",
      os: "macOS",
      isDesktop: true,
    })
  })

  it("detects Safari on iPhone (mobile)", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    expect(parseUserAgent(ua)).toEqual({
      browser: "Safari",
      os: "iPhone",
      isDesktop: false,
    })
  })

  it("detects Firefox on Windows (desktop)", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
    expect(parseUserAgent(ua)).toEqual({
      browser: "Firefox",
      os: "Windows",
      isDesktop: true,
    })
  })

  it("detects Edge over Chrome", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
    expect(parseUserAgent(ua).browser).toBe("Edge")
  })

  it("falls back gracefully for a null user agent", () => {
    expect(parseUserAgent(null)).toEqual({
      browser: "Unknown",
      os: "",
      isDesktop: true,
    })
  })
})
