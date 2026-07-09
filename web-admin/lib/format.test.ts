import { afterEach, describe, expect, it } from "vitest"

import {
  fiatSymbolFor,
  formatAmount,
  formatCrypto,
  formatCryptoAmount,
  formatDelta,
  formatFiat,
  formatMoneyList,
  hydrateFiatDisplay,
  isFiat,
  knownFiatCodes,
} from "./format"

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
  it("places a negative sign BEFORE the symbol (-₦4,950.00, not ₦-4,950.00)", () => {
    expect(formatFiat(-4950, "NGN")).toBe("-₦4,950.00")
    expect(formatFiat("-50", "NGN")).toBe("-₦50.00")
    expect(formatFiat(-1000, "XOF")).toBe("-XOF 1,000.00")
  })
})

describe("isFiat", () => {
  it("is true for a known fiat code", () => {
    expect(isFiat("NGN")).toBe(true)
    expect(isFiat("USD")).toBe(true)
  })
  it("is false for a crypto asset or unknown code", () => {
    expect(isFiat("USDT")).toBe(false)
    expect(isFiat("TRX")).toBe(false)
    expect(isFiat("XOF")).toBe(false)
  })
})

describe("hydrateFiatDisplay (runtime catalog registry)", () => {
  afterEach(() => hydrateFiatDisplay([]))

  it("registers a runtime-added fiat: symbol, isFiat, and formatFiat pick it up", () => {
    hydrateFiatDisplay([{ code: "XOF", symbol: "CFA", decimals: 0 }])
    expect(fiatSymbolFor("XOF")).toBe("CFA")
    expect(isFiat("XOF")).toBe(true)
    // Configured decimals (0) override the 2 dp default.
    expect(formatFiat(1000, "XOF")).toBe("CFA1,000")
    // formatAmount now routes the runtime fiat through formatFiat, not formatCrypto.
    expect(formatAmount("1000", "XOF")).toBe("CFA1,000")
  })

  it("prefers the hydrated symbol/decimals over the static fallback", () => {
    hydrateFiatDisplay([{ code: "NGN", symbol: "NGN ", decimals: 3 }])
    expect(formatFiat(20, "NGN")).toBe("NGN 20.000")
  })

  it("keeps built-in fiats classified as fiat even when absent from the registry", () => {
    hydrateFiatDisplay([{ code: "XOF", symbol: "CFA", decimals: 0 }])
    expect(isFiat("NGN")).toBe(true)
    expect(formatFiat(20000, "NGN")).toBe("₦20,000.00")
  })

  it("knownFiatCodes lists the hydrated catalog, else the offline fallback", () => {
    expect(knownFiatCodes()).toEqual(Object.keys({
      NGN: 1, GHS: 1, KES: 1, UGX: 1, TZS: 1, RWF: 1, ZAR: 1, USD: 1,
    }))
    hydrateFiatDisplay([
      { code: "NGN", symbol: "₦", decimals: 2 },
      { code: "XOF", symbol: "CFA", decimals: 0 },
    ])
    expect(knownFiatCodes()).toEqual(["NGN", "XOF"])
  })

  it("clears back to the offline fallback when hydrated with an empty list", () => {
    hydrateFiatDisplay([{ code: "XOF", symbol: "CFA", decimals: 0 }])
    hydrateFiatDisplay([])
    expect(isFiat("XOF")).toBe(false)
    expect(fiatSymbolFor("XOF")).toBe("XOF")
  })
})

describe("formatCrypto", () => {
  it("keeps the asset's own precision and adds thousands separators", () => {
    expect(formatCrypto("3.048029", "USDT")).toBe("3.048029 USDT")
    expect(formatCrypto(12000.5, "TRX")).toBe("12,000.5 TRX")
    expect(formatCrypto("50", "TRX")).toBe("50 TRX")
  })
  it("carries a negative sign before the number", () => {
    expect(formatCrypto("-3.048029", "USDT")).toBe("-3.048029 USDT")
  })
  it("returns '— <asset>' for a non-finite value", () => {
    expect(formatCrypto("not-a-number", "USDT")).toBe("— USDT")
  })
})

describe("formatCryptoAmount (number-only, for when the asset renders separately)", () => {
  it("adds thousands separators + keeps native precision, WITHOUT an asset code", () => {
    expect(formatCryptoAmount("3.048029")).toBe("3.048029")
    expect(formatCryptoAmount(12000.5)).toBe("12,000.5")
    expect(formatCryptoAmount("50")).toBe("50")
  })
  it("keeps a negative sign; non-finite → em dash", () => {
    expect(formatCryptoAmount("-3.048029")).toBe("-3.048029")
    expect(formatCryptoAmount("not-a-number")).toBe("—")
  })
})

describe("formatDelta (signed reconciliation delta, currency-aware)", () => {
  it("preserves a leading + and formats the magnitude by currency kind", () => {
    expect(formatDelta("+5000", "NGN")).toBe("+₦5,000.00")
    expect(formatDelta("+0.5", "USDT")).toBe("+0.5 USDT")
  })
  it("preserves a negative and formats plain values", () => {
    expect(formatDelta("-4950", "NGN")).toBe("-₦4,950.00")
    expect(formatDelta("50", "USDT")).toBe("50 USDT")
  })
})

describe("formatAmount (currency-aware dispatcher for mixed ledger legs)", () => {
  it("formats a fiat leg with formatFiat", () => {
    expect(formatAmount("5000", "NGN")).toBe("₦5,000.00")
    expect(formatAmount("-4950", "NGN")).toBe("-₦4,950.00")
  })
  it("formats a crypto leg with formatCrypto", () => {
    expect(formatAmount("3.048029", "USDT")).toBe("3.048029 USDT")
    expect(formatAmount("-3.048029", "USDT")).toBe("-3.048029 USDT")
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
