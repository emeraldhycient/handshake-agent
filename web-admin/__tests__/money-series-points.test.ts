import { describe, expect, it } from "vitest"
import type { MoneySeriesMetrics } from "@handshake-agent/contracts"

import { moneySeriesPoints, peakPoint } from "@/lib/money-series-points"

const DATA: MoneySeriesMetrics = {
  buckets: [
    {
      date: "2026-06-01",
      gmv: [
        { currency: "NGN", amount: "50000" },
        { currency: "USD", amount: "120" },
      ],
      revenue: [{ currency: "NGN", amount: "150" }],
      profit: [{ currency: "NGN", amount: "240" }],
    },
    {
      date: "2026-06-02",
      gmv: [{ currency: "NGN", amount: "80000" }],
      revenue: [{ currency: "NGN", amount: "300" }],
      profit: [{ currency: "NGN", amount: "500" }],
    },
  ],
  currencies: ["NGN", "USD"],
}

describe("moneySeriesPoints", () => {
  it("extracts one point per bucket for the chosen metric + currency", () => {
    const points = moneySeriesPoints(DATA, "profit", "NGN")
    expect(points).toEqual([
      { date: "2026-06-01", amount: "240", value: 240 },
      { date: "2026-06-02", amount: "500", value: 500 },
    ])
  })

  it("zero-fills a currency absent from a bucket's metric array", () => {
    // USD has no revenue leg on either day → both zero.
    const points = moneySeriesPoints(DATA, "revenue", "USD")
    expect(points.map((p) => p.amount)).toEqual(["0", "0"])
    expect(points.map((p) => p.value)).toEqual([0, 0])
  })

  it("reads the requested metric independently (gmv has a second currency)", () => {
    const points = moneySeriesPoints(DATA, "gmv", "USD")
    expect(points[0]).toEqual({ date: "2026-06-01", amount: "120", value: 120 })
    // Day two had no USD gmv.
    expect(points[1].amount).toBe("0")
  })
})

describe("peakPoint", () => {
  it("returns the point with the largest value", () => {
    const points = moneySeriesPoints(DATA, "profit", "NGN")
    expect(peakPoint(points)?.amount).toBe("500")
  })

  it("returns null for an empty series", () => {
    expect(peakPoint([])).toBeNull()
  })
})
