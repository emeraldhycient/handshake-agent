import { describe, expect, it } from "vitest"
import { formatNGN, formatCountdown, formatCrypto } from "./format"

describe("formatNGN", () => {
  it("formats a number with ₦ prefix, commas, and 2 decimal places", () => {
    expect(formatNGN(50000)).toBe("₦50,000.00")
    expect(formatNGN("30000")).toBe("₦30,000.00")
    expect(formatNGN("1234567.89")).toBe("₦1,234,567.89")
    expect(formatNGN(0)).toBe("₦0.00")
  })

  it("returns ₦— for NaN / non-finite values", () => {
    expect(formatNGN("abc")).toBe("₦—")
    expect(formatNGN(NaN)).toBe("₦—")
    expect(formatNGN(Infinity)).toBe("₦—")
    expect(formatNGN(-Infinity)).toBe("₦—")
  })

  it("handles string numeric input", () => {
    expect(formatNGN("1000")).toBe("₦1,000.00")
    expect(formatNGN("0.5")).toBe("₦0.50")
  })
})

describe("formatCountdown", () => {
  it("formats seconds as m:ss", () => {
    expect(formatCountdown(90)).toBe("1:30")
    expect(formatCountdown(58)).toBe("0:58")
    expect(formatCountdown(0)).toBe("0:00")
    expect(formatCountdown(60)).toBe("1:00")
    expect(formatCountdown(3600)).toBe("60:00")
  })

  it("floors fractional seconds", () => {
    expect(formatCountdown(59.9)).toBe("0:59")
    expect(formatCountdown(60.4)).toBe("1:00")
  })

  it("clamps negative values to 0:00", () => {
    expect(formatCountdown(-5)).toBe("0:00")
  })
})

describe("formatCrypto", () => {
  it("appends asset symbol with a space", () => {
    expect(formatCrypto("31.25", "USDT")).toBe("31.25 USDT")
    expect(formatCrypto("0.001", "BTC")).toBe("0.001 BTC")
    expect(formatCrypto("1000", "USDC")).toBe("1000 USDC")
  })
})
