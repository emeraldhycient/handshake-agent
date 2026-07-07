import { describe, expect, it } from "vitest"

import { deriveKind, shortDate } from "./format"

describe("deriveKind", () => {
  it("classes EVM + TRON addresses as 'address'", () => {
    expect(deriveKind("0x" + "a".repeat(40))).toBe("address")
    expect(deriveKind("T" + "9".repeat(33))).toBe("address")
  })
  it("classes a bare 10-digit NUBAN as 'bank'", () => {
    expect(deriveKind("0123456789")).toBe("bank")
    expect(deriveKind("0123456789 · GTBank")).toBe("bank")
  })
  it("falls back to 'user' for identifiers / handles", () => {
    expect(deriveKind("amara.okeke")).toBe("user")
    expect(deriveKind("user_123")).toBe("user")
  })
})

describe("shortDate", () => {
  it("renders a short 'MMM D' label", () => {
    expect(shortDate("2026-06-30T12:00:00.000Z")).toMatch(/^[A-Z][a-z]{2} \d+$/)
  })
})
