import { describe, expect, it } from "vitest"
import type {
  TreasuryBalance,
  TreasuryExposure,
  TreasuryFiatFloat,
  TreasuryFxPosition,
  TreasuryPayoutQueueItem,
  TreasurySweep,
} from "@handshake-agent/contracts"

import {
  bpsToPct,
  formatFiat,
  resolveExposureCard,
  resolveFiatFloatCard,
  resolveFxPositionCard,
  resolveHeroCard,
  toPayoutRow,
  toSweepRow,
} from "./cards"

describe("formatFiat + bpsToPct", () => {
  it("groups NGN and falls back to the raw string", () => {
    expect(formatFiat("42180500")).toBe("₦42,180,500.00")
    expect(formatFiat("n/a")).toBe("n/a")
  })
  it("rounds bps to a whole percent", () => {
    expect(bpsToPct(1802)).toBe("18%")
    expect(bpsToPct(7200)).toBe("72%")
  })
})

describe("resolveHeroCard", () => {
  const usdtTron: TreasuryBalance = {
    network: "TRON",
    asset: "USDT",
    totalAmount: "412908.44",
    walletCount: 12,
  }
  it("prefers USDT-on-TRON and pluralizes wallets", () => {
    const card = resolveHeroCard([
      { network: "EVM", asset: "USDC", totalAmount: "5", walletCount: 40 },
      usdtTron,
    ])
    expect(card.tone).toBe("hero")
    expect(card.value).toBe("412,908.44 USDT")
    expect(card.note).toBe("12 wallets · TRON")
  })
  it("falls back to an em-dash when there are no balances", () => {
    const card = resolveHeroCard([])
    expect(card.value).toBe("—")
    expect(card.note).toBe("No custodial wallets")
  })
})

describe("resolveFiatFloatCard", () => {
  it("shows NGN balance + utilization + low status dot", () => {
    const float: TreasuryFiatFloat = {
      currency: "NGN",
      balance: "42180500",
      targetFloat: "50000000",
      utilizationBps: 1802,
      status: "low",
      lowFloatThresholdBps: 2000,
    }
    const card = resolveFiatFloatCard([float])
    expect(card.value).toBe("₦42,180,500.00")
    expect(card.note).toBe("18% of target · low")
    expect(card.dot).toBe("warn")
  })
  it("falls back when there is no float row", () => {
    expect(resolveFiatFloatCard([]).value).toBe("—")
  })
})

describe("resolveFxPositionCard", () => {
  const long: TreasuryFxPosition = {
    asset: "USDT",
    fiatCurrency: "NGN",
    netPositionFiat: "8240",
    direction: "long",
    headroomBps: 7200,
    exposureStatus: "safe",
  }
  it("labels a long position", () => {
    const card = resolveFxPositionCard([long])
    expect(card.value).toBe("₦8,240.00")
    expect(card.note).toBe("Net long USDT vs NGN")
  })
  it("falls back when there is no position row", () => {
    expect(resolveFxPositionCard([]).value).toBe("—")
  })
})

describe("resolveExposureCard", () => {
  const pos = (headroomBps: number): TreasuryFxPosition => ({
    asset: "USDT",
    fiatCurrency: "NGN",
    netPositionFiat: "0",
    direction: "flat",
    headroomBps,
    exposureStatus: "safe",
  })
  it("uses the tightest position's headroom %", () => {
    const card = resolveExposureCard([], [pos(9000), pos(7200)])
    expect(card.value).toBe("72%")
    expect(card.note).toBe("Within inventory limit")
  })
  it("falls back to the worst exposure snapshot when no FX position", () => {
    const exposure: TreasuryExposure = {
      id: "00000000-0000-4000-8000-000000000000",
      asset: "USDT",
      fiatCurrency: "NGN",
      cryptoHeld: "1",
      fiatEquivalent: "1",
      netExposure: "1",
      exposureLimitBps: 5000,
      status: "warning",
      createdAt: "2026-07-01T00:00:00.000Z",
    }
    const card = resolveExposureCard([exposure], [])
    expect(card.value).toBe("warning")
    expect(card.dot).toBe("warn")
  })
})

describe("toSweepRow + toPayoutRow", () => {
  it("maps a sweep with its status label", () => {
    const sweep: TreasurySweep = {
      id: "s1",
      address: "TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt",
      network: "TRON",
      asset: "TRX",
      balance: "18.4",
      status: "below_threshold",
      lastSweptAt: null,
    }
    const row = toSweepRow(sweep)
    expect(row.addr).toBe("TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt")
    expect(row.bal).toBe("18.4 TRX")
    expect(row.status).toBe("Below threshold")
  })
  it("maps a payout with its approval flag", () => {
    const item: TreasuryPayoutQueueItem = {
      id: "p1",
      transactionId: "00000000-0000-4000-8000-000000000001",
      beneficiaryLabel: "Kelechi Chukwu · GTBank",
      reference: "WD-8821",
      method: "Bank transfer",
      asset: "NGN",
      amount: "4820000",
      fiatAmount: null,
      requiresApproval: true,
      submittedAt: "2026-07-01T00:00:00.000Z",
    }
    const row = toPayoutRow(item)
    expect(row.to).toBe("Kelechi Chukwu · GTBank")
    expect(row.ref).toBe("WD-8821")
    expect(row.big).toBe(true)
  })
})
