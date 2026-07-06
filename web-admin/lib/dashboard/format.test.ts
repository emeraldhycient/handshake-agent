import { describe, expect, it } from "vitest"
import type {
  DashboardSummary,
  ProviderHealth,
} from "@handshake-agent/contracts"

import {
  activityItemFrom,
  bucketLabel,
  deriveKpis,
  fmtInt,
  healthRowFrom,
  relativeTime,
  volBarsFrom,
} from "./format"

const SUMMARY: DashboardSummary = {
  txnVolume: {
    byType: [
      { type: "buy", count: 120, completed: 110, failed: 10, stuck: 3 },
      { type: "send", count: 40, completed: 38, failed: 2, stuck: 1 },
    ],
    series: [],
    stackedSeries: [
      {
        date: "2026-06-28",
        buy: 8,
        sell: 0,
        send: 4,
        swap: 0,
        ticket: 0,
        total: 12,
      },
    ],
    successRate: 0.925,
  },
  gmv: {
    totalByCurrency: [{ currency: "NGN", amount: "1250000.00" }],
    txnCount: 148,
  },
  revenue: {
    totalFeesByCurrency: [{ currency: "NGN", amount: "45000.00" }],
    totalSpreadByCurrency: [{ currency: "NGN", amount: "30000.00" }],
    totalProfitByCurrency: [{ currency: "NGN", amount: "75000.00" }],
    txnCount: 148,
  },
  kycFunnel: {
    byStatus: [
      { status: "approved", count: 300 },
      { status: "pending", count: 25 },
      { status: "needs_info", count: 5 },
    ],
    byTier: [{ tier: "tier_1", count: 200 }],
  },
  activeUsers: { activeInRange: 88, newInRange: 14, totalUsers: 325 },
  serviceHealth: { services: [] },
}

describe("fmtInt", () => {
  it("groups with en-NG thousands separators", () => {
    expect(fmtInt(1250000)).toBe("1,250,000")
  })
})

describe("deriveKpis", () => {
  const kpis = deriveKpis(SUMMARY, 7)
  const by = (label: string) => kpis.find((k) => k.label === label)

  it("derives totals, KYC-pending, failed·stuck and success rate", () => {
    expect(by("Transaction volume")?.value).toBe("160") // 120 + 40
    expect(by("Transaction volume")?.delta).toBe("92.5%")
    expect(by("KYC pending")?.value).toBe("30") // pending 25 + needs_info 5
    expect(by("Failed · stuck tx")?.value).toBe("12 · 4") // 10+2 · 3+1
    expect(by("New signups")?.value).toBe("14")
  })

  it("renders open-compliance count, or an em dash while unknown", () => {
    expect(by("Open compliance cases")?.value).toBe("7")
    const unknown = deriveKpis(SUMMARY, undefined).find(
      (k) => k.label === "Open compliance cases"
    )
    expect(unknown?.value).toBe("—")
    expect(unknown?.delta).toBe("—")
  })
})

describe("bucketLabel + volBarsFrom", () => {
  it("labels a YYYY-MM-DD bucket as 'MMM D'", () => {
    expect(bucketLabel("2026-06-28")).toBe("Jun 28")
  })
  it("maps stacked series onto ChartBar segments", () => {
    const bars = volBarsFrom(SUMMARY.txnVolume.stackedSeries)
    expect(bars).toHaveLength(1)
    expect(bars[0].label).toBe("Jun 28")
    expect(bars[0].segments).toEqual({
      buy: 8,
      sell: 0,
      send: 4,
      swap: 0,
      ticket: 0,
    })
  })
})

describe("healthRowFrom", () => {
  const base: ProviderHealth = {
    key: "blockradar",
    name: "Blockradar",
    note: "Custodial WaaS",
    status: "ok",
    lastLatencyMs: 120,
  }
  it("shows observed latency, or an em dash when unmeasured", () => {
    expect(healthRowFrom(base).status).toBe("120ms")
    expect(healthRowFrom({ ...base, lastLatencyMs: null }).status).toBe("—")
  })
})

describe("relativeTime + activityItemFrom", () => {
  const now = Date.UTC(2026, 5, 28, 12, 0, 0)
  it("buckets now / minutes / hours / days (no 'ago' suffix)", () => {
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe("now")
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe(
      "5m"
    )
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe(
      "3h"
    )
    expect(
      relativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)
    ).toBe("2d")
  })
  it("maps an event onto icon/tint + relative time", () => {
    const item = activityItemFrom({
      id: "tx_1",
      kind: "settled",
      title: "Buy settled",
      meta: "tx_1 · 120 USDT",
      at: new Date().toISOString(),
    })
    expect(item.text).toBe("Buy settled")
    expect(item.meta).toBe("tx_1 · 120 USDT")
    expect(item.icon).toBeTruthy()
  })
})
