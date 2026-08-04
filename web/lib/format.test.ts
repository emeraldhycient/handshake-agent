import { afterEach, describe, expect, it } from "vitest"
import {
  DISPLAY_LOCALE,
  formatFiat,
  fiatSymbolFor,
  formatCountdown,
  hydrateFiatDisplay,
} from "./format"

// The registry is module-level state — always restore the offline fallback so
// test order can never leak configured symbols between cases.
afterEach(() => {
  hydrateFiatDisplay([])
})

describe("DISPLAY_LOCALE", () => {
  it("is the single neutral display locale (en-GB) shared by every formatter", () => {
    expect(DISPLAY_LOCALE).toBe("en-GB")
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

  it("prefers a /config-hydrated symbol over the static fallback", () => {
    hydrateFiatDisplay([{ code: "NGN", symbol: "N₦", decimals: 2 }])
    expect(fiatSymbolFor("NGN")).toBe("N₦")
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

describe("formatFiat with a hydrated /config registry", () => {
  it("uses the configured symbol for a code the static map does not know", () => {
    hydrateFiatDisplay([{ code: "XOF", symbol: "CFA", decimals: 2 }])
    expect(formatFiat("1000", "XOF")).toBe("CFA1,000.00")
  })

  it("honours the configured decimals (0-decimal currency)", () => {
    hydrateFiatDisplay([{ code: "UGX", symbol: "USh", decimals: 0 }])
    expect(formatFiat("50000", "UGX")).toBe("USh50,000")
  })

  it("configured entries win over the static fallback map", () => {
    hydrateFiatDisplay([{ code: "GHS", symbol: "₵", decimals: 2 }])
    expect(formatFiat("20000", "GHS")).toBe("₵20,000.00")
  })

  it("re-hydration replaces the whole registry (dropped codes fall back)", () => {
    hydrateFiatDisplay([{ code: "GHS", symbol: "₵", decimals: 2 }])
    hydrateFiatDisplay([{ code: "NGN", symbol: "₦", decimals: 2 }])
    // GHS is no longer configured → falls back to the static map.
    expect(formatFiat("20000", "GHS")).toBe("GH₵20,000.00")
  })

  it("codes absent from both registry and static map still use the code prefix", () => {
    hydrateFiatDisplay([{ code: "NGN", symbol: "₦", decimals: 2 }])
    expect(formatFiat("1000", "EUR")).toBe("EUR 1,000.00")
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
