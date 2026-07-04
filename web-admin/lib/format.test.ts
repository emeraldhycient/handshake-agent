import { describe, expect, it } from "vitest"

import { fiatSymbolFor, formatFiat, formatMoneyList } from "./format"

describe("fiatSymbolFor", () => {
  it("resolves known fiat symbols", () => {
    expect(fiatSymbolFor("NGN")).toBe("₦")
    expect(fiatSymbolFor("GHS")).toBe("GH₵")
    expect(fiatSymbolFor("USD")).toBe("$")
  })
  it("falls back to the code for an unknown currency", () => {
    expect(fiatSymbolFor("XOF")).toBe("XOF")
  })
})

describe("formatFiat", () => {
  it("prefixes a known symbol with no space, 2 dp, thousands separators", () => {
    expect(formatFiat(20000, "NGN")).toBe("₦20,000.00")
    expect(formatFiat("1477.8336", "NGN")).toBe("₦1,477.83")
    expect(formatFiat(120.5, "USD")).toBe("$120.50")
  })
  it("shows an unknown currency code with a trailing space", () => {
    expect(formatFiat(1000, "XOF")).toBe("XOF 1,000.00")
  })
  it("returns <symbol>— for a non-finite value", () => {
    expect(formatFiat("not-a-number", "NGN")).toBe("₦—")
  })
})

describe("formatMoneyList", () => {
  it("returns — for an empty list", () => {
    expect(formatMoneyList([])).toBe("—")
  })
  it("formats a single currency", () => {
    expect(formatMoneyList([{ currency: "NGN", amount: "600" }])).toBe(
      "₦600.00",
    )
  })
  it("joins multiple currencies with a middot (per-currency, never summed)", () => {
    expect(
      formatMoneyList([
        { currency: "NGN", amount: "600" },
        { currency: "USD", amount: "120.5" },
      ]),
    ).toBe("₦600.00 · $120.50")
  })
})
