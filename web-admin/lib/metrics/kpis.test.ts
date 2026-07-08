import { describe, expect, it } from "vitest"
import type { DashboardSummary } from "@handshake-agent/contracts"

import { buildKpiTiles, formatPct } from "./kpis"

const SUMMARY: DashboardSummary = {
  txnVolume: {
    byType: [
      { type: "buy", count: 120, completed: 110, failed: 10, stuck: 0 },
      { type: "send", count: 40, completed: 38, failed: 2, stuck: 0 },
    ],
    series: [],
    stackedSeries: [],
    successRate: 0.925,
  },
  gmv: { totalByCurrency: [], txnCount: 148 },
  revenue: {
    totalFeesByCurrency: [
      { currency: "NGN", amount: "45000.00" },
      { currency: "USD", amount: "120.50" },
    ],
    totalSpreadByCurrency: [],
    totalProfitByCurrency: [
      { currency: "NGN", amount: "75000.00" },
      { currency: "USD", amount: "200.50" },
    ],
    txnCount: 148,
  },
  kycFunnel: { byStatus: [], byTier: [] },
  activeUsers: { activeInRange: 88, newInRange: 14, totalUsers: 325 },
  serviceHealth: { services: [] },
}

describe("formatPct", () => {
  it("renders a [0,1] rate as a one-decimal percentage", () => {
    expect(formatPct(0.925)).toBe("92.5%")
    expect(formatPct(1)).toBe("100.0%")
    expect(formatPct(0)).toBe("0.0%")
  })
})

describe("buildKpiTiles", () => {
  it("sums byType counts into the hero total-transactions tile", () => {
    const [hero] = buildKpiTiles(SUMMARY)
    expect(hero.hero).toBe(true)
    expect(hero.label).toBe("Total transactions")
    expect(hero.value).toBe("160")
    expect(hero.delta).toBe("92.5%")
  })
  it("shows fees per-currency and a fees+spread profit footnote", () => {
    const tiles = buildKpiTiles(SUMMARY)
    const revenue = tiles.find((t) => t.label === "Revenue (fees)")
    expect(revenue?.value).toBe("₦45,000.00 · $120.50")
    expect(revenue?.deltaNote).toBe("fees collected")
    expect(revenue?.footnote).toBe(
      "Profit ₦75,000.00 · $200.50 (fees + spread)"
    )
    expect(revenue?.warn).toBe(false)
  })
  it("warns and notes 'No fee revenue' when the fee spread is empty", () => {
    const tiles = buildKpiTiles({
      ...SUMMARY,
      revenue: { ...SUMMARY.revenue, totalFeesByCurrency: [] },
    })
    const revenue = tiles.find((t) => t.label === "Revenue (fees)")
    expect(revenue?.warn).toBe(true)
    expect(revenue?.deltaNote).toBe("No fee revenue")
  })
})
