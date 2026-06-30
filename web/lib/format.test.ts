import { describe, expect, it } from "vitest"
import {
  formatNGN,
  formatFiat,
  fiatSymbolFor,
  formatCountdown,
  formatCrypto,
} from "./format"

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

describe("fiatSymbolFor", () => {
  it("resolves known fiat symbols from the code", () => {
    expect(fiatSymbolFor("NGN")).toBe("₦")
    expect(fiatSymbolFor("GHS")).toBe("GH₵")
    expect(fiatSymbolFor("KES")).toBe("KSh")
    expect(fiatSymbolFor("USD")).toBe("$")
  })

  it("falls back to the code itself for an unknown currency", () => {
    expect(fiatSymbolFor("XOF")).toBe("XOF")
  })
})

describe("formatFiat (multi-currency precise formatter)", () => {
  it("prefixes a known symbol with no space, 2dp + thousands", () => {
    expect(formatFiat(20000, "NGN")).toBe("₦20,000.00")
    expect(formatFiat("1500", "KES")).toBe("KSh1,500.00")
    expect(formatFiat("20000", "GHS")).toBe("GH₵20,000.00")
  })

  it("uses the code with a trailing space for an unknown currency", () => {
    expect(formatFiat("1000", "XOF")).toBe("XOF 1,000.00")
  })

  it("returns '<prefix>—' for non-finite values", () => {
    expect(formatFiat("abc", "NGN")).toBe("₦—")
    expect(formatFiat(NaN, "GHS")).toBe("GH₵—")
    expect(formatFiat(Infinity, "XOF")).toBe("XOF —")
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
