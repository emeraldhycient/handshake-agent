import { describe, expect, it } from "vitest"

import { formatDate, typeLabel, verificationVariant } from "./rows"

describe("formatDate", () => {
  it("em-dashes a null date", () => {
    expect(formatDate(null)).toBe("—")
  })
  it("formats a valid ISO date via toLocaleString", () => {
    const iso = "2026-07-02T00:00:00.000Z"
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleString())
  })
})

describe("typeLabel", () => {
  it("labels bank vs. on-chain address", () => {
    expect(typeLabel("bank_account")).toBe("Bank account")
    expect(typeLabel("crypto_address")).toBe("USDT address")
  })
})

describe("verificationVariant", () => {
  it("maps status onto a pill variant (case-insensitive)", () => {
    expect(verificationVariant("verified")).toBe("success")
    expect(verificationVariant("FAILED")).toBe("danger")
    expect(verificationVariant("rejected")).toBe("danger")
    expect(verificationVariant("pending")).toBe("warn")
    expect(verificationVariant("unverified")).toBe("warn")
    expect(verificationVariant("something-else")).toBe("neutral")
  })
})
