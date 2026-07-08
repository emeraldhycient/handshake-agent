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
  resolveExposureCard,
  resolveFiatFloatCards,
  resolveFxPositionCards,
  resolveHeroCard,
  toPayoutRow,
  toSweepRow,
} from "./cards"

describe("bpsToPct", () => {
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

describe("resolveFiatFloatCards (one card per currency)", () => {
  const float = (over: Partial<TreasuryFiatFloat>): TreasuryFiatFloat => ({
    currency: "NGN",
    balance: "42180500",
    targetFloat: "50000000",
    utilizationBps: 1802,
    status: "low",
    lowFloatThresholdBps: 2000,
    ...over,
  })

  it("renders one card per currency, each in its OWN currency's format", () => {
    const cards = resolveFiatFloatCards([
      float({}),
      float({
        currency: "GHS",
        balance: "125000",
        utilizationBps: 8000,
        status: "healthy",
      }),
    ])
    expect(cards).toHaveLength(2)
    expect(cards[0].id).toBe("fiat-float-ngn")
    expect(cards[0].label).toBe("NGN fiat float")
    expect(cards[0].value).toBe("₦42,180,500.00")
    expect(cards[0].note).toBe("18% of target · low")
    expect(cards[0].dot).toBe("warn")
    expect(cards[1].id).toBe("fiat-float-ghs")
    expect(cards[1].label).toBe("GHS fiat float")
    expect(cards[1].value).toBe("GH₵125,000.00")
    expect(cards[1].dot).toBe("ok")
  })

  it("falls back to a single em-dash card when there are no float rows", () => {
    const cards = resolveFiatFloatCards([])
    expect(cards).toHaveLength(1)
    expect(cards[0].value).toBe("—")
    expect(cards[0].note).toBe("No fiat-float rows")
  })
})

describe("resolveFxPositionCards (each position in its own fiat)", () => {
  const long: TreasuryFxPosition = {
    asset: "USDT",
    fiatCurrency: "NGN",
    netPositionFiat: "8240",
    direction: "long",
    headroomBps: 7200,
    exposureStatus: "safe",
  }
  it("labels a single long position with the plain design label", () => {
    const cards = resolveFxPositionCards([long])
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe("fx-position-usdt-ngn")
    expect(cards[0].label).toBe("FX position")
    expect(cards[0].value).toBe("₦8,240.00")
    expect(cards[0].note).toBe("Net long USDT vs NGN")
  })
  it("disambiguates multiple positions and formats each in its own fiat", () => {
    const cards = resolveFxPositionCards([
      long,
      {
        asset: "USDT",
        fiatCurrency: "GHS",
        netPositionFiat: "-320.5",
        direction: "short",
        headroomBps: 400,
        exposureStatus: "critical",
      },
    ])
    expect(cards).toHaveLength(2)
    expect(cards[0].label).toBe("FX position · USDT/NGN")
    expect(cards[1].label).toBe("FX position · USDT/GHS")
    expect(cards[1].value).toBe("-GH₵320.50")
    expect(cards[1].note).toBe("Net short USDT vs GHS")
    expect(cards[1].dot).toBe("danger")
  })
  it("falls back to a single em-dash card when there is no position row", () => {
    const cards = resolveFxPositionCards([])
    expect(cards).toHaveLength(1)
    expect(cards[0].value).toBe("—")
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

  const payout = (
    over: Partial<TreasuryPayoutQueueItem>
  ): TreasuryPayoutQueueItem => ({
    id: "p1",
    transactionId: "00000000-0000-4000-8000-000000000001",
    beneficiaryLabel: "Kelechi Chukwu · GTBank",
    reference: "WD-8821",
    method: "Bank transfer",
    asset: "NGN",
    amount: "4820000",
    fiatAmount: null,
    fiatCurrency: "NGN",
    requiresApproval: true,
    submittedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  })

  it("maps a fiat payout in its own currency with the approval flag", () => {
    const row = toPayoutRow(payout({}))
    expect(row.to).toBe("Kelechi Chukwu · GTBank")
    expect(row.ref).toBe("WD-8821")
    expect(row.amt).toBe("₦4,820,000.00")
    expect(row.fiat).toBeNull()
    expect(row.big).toBe(true)
  })

  it("carries the fiat leg (in ITS fiatCurrency) for a crypto payout", () => {
    const row = toPayoutRow(
      payout({
        asset: "USDT",
        amount: "1250",
        fiatAmount: "19125.50",
        fiatCurrency: "GHS",
        requiresApproval: false,
      })
    )
    expect(row.amt).toBe("1,250 USDT")
    expect(row.fiat).toBe("≈ GH₵19,125.50")
    expect(row.big).toBe(false)
  })
})
