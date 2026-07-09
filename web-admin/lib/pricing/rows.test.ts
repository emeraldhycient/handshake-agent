import { describe, expect, it } from "vitest"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import {
  bpsToPct,
  buildBaseRates,
  buildSpreadRows,
  formatRate,
  num,
  parseValue,
  pricingCurrencies,
} from "./rows"
import { baseRateAddTarget, feeTarget, spreadTarget } from "./targets"

function s(key: string, value: unknown): EffectiveSetting {
  return {
    key,
    label: key,
    description: "",
    category: "Pricing",
    valueType: typeof value === "number" ? "number" : "string",
    editable: true,
    value,
    scope: "global",
    scopeValue: null,
    source: "db",
  }
}

describe("scalar formatters", () => {
  it("bpsToPct / formatRate / num", () => {
    expect(bpsToPct(150)).toBe("1.50%")
    expect(formatRate("NGN", 1375)).toBe("1,375 NGN")
    expect(num(s("k", 12))).toBe(12)
    expect(num(s("k", "x"))).toBe(null)
    expect(num(undefined)).toBe(null)
  })
})

describe("parseValue", () => {
  it("rejects empty / negative / non-finite, and non-integers when integer", () => {
    expect(parseValue("", true)).toBe(null)
    expect(parseValue("-1", false)).toBe(null)
    expect(parseValue("abc", false)).toBe(null)
    expect(parseValue("1.5", true)).toBe(null)
    expect(parseValue("1.5", false)).toBe(1.5)
    expect(parseValue("100", true)).toBe(100)
  })
})

describe("buildSpreadRows", () => {
  const settings = [
    s("pricing.processingFeeBps", 100),
    s("pricing.assets.USDT.baseRates.NGN", 1375),
    s("pricing.assets.USDT.buySpreadBps", 150),
    s("pricing.assets.USDT.sellSpreadBps", 150),
  ]

  it("derives buy/sell user rate + margin from base rate, spread and fee", () => {
    const rows = buildSpreadRows(settings, "NGN")
    expect(rows).toHaveLength(2)
    const buy = rows.find((r) => r.dir === "buy")!
    // 1375 * (1 + 150/10000) ≈ 1395.6249… → ₦1,395.62 (float rounds down)
    expect(buy.userRate).toBe("₦1,395.62")
    // margin = spread% (1.50) + fee% (1.00) = 2.50%
    expect(buy.margin).toBe("2.50%")
    expect(buy.spread).toBe("1.50%")
    expect(buy.spreadKey).toBe("pricing.assets.USDT.buySpreadBps")
    const sell = rows.find((r) => r.dir === "sell")!
    // 1375 * (1 - 0.015) = 1354.375 → ₦1,354.38
    expect(sell.userRate).toBe("₦1,354.38")
  })

  it("previews an em-dash when the currency has no base rate", () => {
    const rows = buildSpreadRows(settings, "GHS")
    // No GHS base rate for USDT → row still present (spreads exist), rate '—'.
    expect(rows[0].userRate).toBe("—")
  })

  it("skips an asset with no base rate and no spreads", () => {
    expect(
      buildSpreadRows([s("pricing.processingFeeBps", 100)], "NGN")
    ).toEqual([])
  })
})

describe("pricingCurrencies", () => {
  it("collects base-rate codes with NGN first, defaults to NGN when none", () => {
    expect(
      pricingCurrencies([
        s("pricing.assets.USDT.baseRates.GHS", 19),
        s("pricing.assets.USDT.baseRates.NGN", 1375),
      ])
    ).toEqual(["NGN", "GHS"])
    expect(pricingCurrencies([])).toEqual(["NGN"])
  })
})

describe("buildBaseRates", () => {
  it("splits numeric rows from unpriced options, sorted by asset then code", () => {
    const { rows, options } = buildBaseRates([
      s("pricing.assets.USDT.baseRates.NGN", 1375),
      s("pricing.assets.BTC.baseRates.NGN", null),
    ])
    expect(rows.map((r) => r.id)).toEqual(["USDT-NGN"])
    expect(rows[0].label).toBe("1,375 NGN")
    expect(options).toEqual([{ asset: "BTC", code: "NGN" }])
  })
})

describe("edit-target factories", () => {
  it("spreadTarget is integer bps with the spread key", () => {
    const row = buildSpreadRows(
      [
        s("pricing.assets.USDT.baseRates.NGN", 1375),
        s("pricing.assets.USDT.buySpreadBps", 150),
      ],
      "NGN"
    ).find((r) => r.dir === "buy")!
    const t = spreadTarget(row)
    expect(t.key).toBe("pricing.assets.USDT.buySpreadBps")
    expect(t.integer).toBe(true)
    expect(t.seed).toBe("150")
  })
  it("feeTarget carries the fee key + label", () => {
    const t = feeTarget(s("pricing.processingFeeBps", 100), 100, "1.00%")
    expect(t.key).toBe("pricing.processingFeeBps")
    expect(t.currentLabel).toBe("1.00%")
    expect(t.format(150)).toBe("1.50%")
  })
  it("baseRateAddTarget builds the new base-rate key", () => {
    const t = baseRateAddTarget("BTC", "GHS", 19.5)
    expect(t.key).toBe("pricing.assets.BTC.baseRates.GHS")
    expect(t.currentLabel).toBe("—")
    expect(t.format(19.5)).toBe("19.5 GHS")
  })
})
