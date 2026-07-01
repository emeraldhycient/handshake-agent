/**
 * TreasuryPage tests (Phase 6b — every read is live).
 *
 * The display data comes from the admin treasury hooks: `useTreasuryBalances`
 * (custodial hero), `useTreasuryFiatFloat` (NGN float tile), `useTreasuryFxPosition`
 * (FX-position tile + the derived exposure-headroom %), `useTreasuryExposure`
 * (fallback status), `useTreasuryAlerts` (warning banner), `useTreasurySweeps`
 * (child-address sweep rows + threshold), and `useTreasuryPayoutQueue` (the pending
 * payout / withdrawal approval queue). The `lib/api/treasury` client is mocked (no
 * server); the tests cover loading → data plus the empty and error branches.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  TreasuryAlertListResponse,
  TreasuryBalancesResponse,
  TreasuryExposureListResponse,
  TreasuryFiatFloatResponse,
  TreasuryFxPositionResponse,
  TreasuryPayoutQueueResponse,
  TreasurySweepListResponse,
} from "@handshake-agent/contracts"

import { TreasuryPage } from "@/components/admin/treasury-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/treasury", () => ({
  listTreasuryBalances: vi.fn(),
  listTreasuryExposure: vi.fn(),
  listTreasuryAlerts: vi.fn(),
  listTreasurySweeps: vi.fn(),
  listTreasuryPayoutQueue: vi.fn(),
  listTreasuryFiatFloat: vi.fn(),
  listTreasuryFxPosition: vi.fn(),
}))

import {
  listTreasuryBalances,
  listTreasuryExposure,
  listTreasuryAlerts,
  listTreasurySweeps,
  listTreasuryPayoutQueue,
  listTreasuryFiatFloat,
  listTreasuryFxPosition,
} from "@/lib/api/treasury"

const mockBalances = vi.mocked(listTreasuryBalances)
const mockExposure = vi.mocked(listTreasuryExposure)
const mockAlerts = vi.mocked(listTreasuryAlerts)
const mockSweeps = vi.mocked(listTreasurySweeps)
const mockPayouts = vi.mocked(listTreasuryPayoutQueue)
const mockFiatFloat = vi.mocked(listTreasuryFiatFloat)
const mockFx = vi.mocked(listTreasuryFxPosition)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BALANCES: TreasuryBalancesResponse = {
  balances: [
    { network: "TRON", asset: "USDT", totalAmount: "412908.44", walletCount: 12 },
    { network: "TRON", asset: "TRX", totalAmount: "980.10", walletCount: 12 },
  ],
}

const EXPOSURE: TreasuryExposureListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      asset: "USDT",
      fiatCurrency: "NGN",
      cryptoHeld: "412908.44",
      fiatEquivalent: "640000000.00",
      netExposure: "180000.00",
      exposureLimitBps: 500,
      status: "warning",
      createdAt: "2026-07-01T04:00:00.000Z",
    },
  ],
}

const ALERTS: TreasuryAlertListResponse = {
  items: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      asset: "USDT",
      severity: "critical",
      message: "USDT net exposure exceeds the configured inventory limit.",
      netExposure: "180000.00",
      triggeredAt: "2026-07-01T03:59:00.000Z",
      acknowledgedAt: null,
    },
  ],
}

const SWEEPS: TreasurySweepListResponse = {
  items: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      address: "TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt",
      network: "TRON",
      asset: "TRX",
      balance: "18.40",
      status: "below_threshold",
      lastSweptAt: null,
    },
  ],
  sweepThreshold: "25",
  thresholdAsset: "TRX",
}

const PAYOUTS: TreasuryPayoutQueueResponse = {
  items: [
    {
      id: "44444444-4444-4444-4444-444444444444",
      transactionId: "55555555-5555-5555-5555-555555555555",
      beneficiaryLabel: "Kelechi Chukwu · GTBank",
      reference: "wd_44219",
      method: "NGN payout · Flutterwave",
      asset: "NGN",
      amount: "4820000.00",
      fiatAmount: null,
      requiresApproval: true,
      submittedAt: "2026-07-01T03:00:00.000Z",
    },
    {
      id: "66666666-6666-6666-6666-666666666666",
      transactionId: "77777777-7777-7777-7777-777777777777",
      beneficiaryLabel: "TRON withdrawal",
      reference: "wd_44220",
      method: "USDT · Blockradar",
      asset: "USDT",
      amount: "1250.00",
      fiatAmount: null,
      requiresApproval: false,
      submittedAt: "2026-07-01T02:00:00.000Z",
    },
  ],
}

const FIAT_FLOAT: TreasuryFiatFloatResponse = {
  items: [
    {
      currency: "NGN",
      balance: "42180500.00",
      targetFloat: "234000000",
      utilizationBps: 1803,
      status: "low",
      lowFloatThresholdBps: 2500,
    },
  ],
}

const FX: TreasuryFxPositionResponse = {
  items: [
    {
      asset: "USDT",
      fiatCurrency: "NGN",
      netPositionFiat: "8240.00",
      direction: "long",
      headroomBps: 7200,
      exposureStatus: "safe",
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TreasuryPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockBalances.mockReset().mockResolvedValue(BALANCES)
  mockExposure.mockReset().mockResolvedValue(EXPOSURE)
  mockAlerts.mockReset().mockResolvedValue(ALERTS)
  mockSweeps.mockReset().mockResolvedValue(SWEEPS)
  mockPayouts.mockReset().mockResolvedValue(PAYOUTS)
  mockFiatFloat.mockReset().mockResolvedValue(FIAT_FLOAT)
  mockFx.mockReset().mockResolvedValue(FX)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TreasuryPage (wired)", () => {
  it("renders the header always", () => {
    renderPage()
    expect(
      screen.getByRole("heading", { name: "Treasury" })
    ).toBeInTheDocument()
  })

  it("shows a loading skeleton before the balances resolve", () => {
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText("412908.44")).not.toBeInTheDocument()
  })

  it("wires the custodial hero from real aggregated balances", async () => {
    renderPage()
    expect(await screen.findByText("412908.44")).toBeInTheDocument()
    expect(screen.getByText("Custodial · USDT")).toBeInTheDocument()
    expect(screen.getByText("12 wallets · TRON")).toBeInTheDocument()
  })

  it("wires the NGN fiat-float tile with utilization + status", async () => {
    renderPage()
    expect(await screen.findByText("₦42,180,500.00")).toBeInTheDocument()
    expect(screen.getByText("NGN fiat float")).toBeInTheDocument()
    // 1803 bps → 18%; status low.
    expect(screen.getByText("18% of target · low")).toBeInTheDocument()
  })

  it("wires the FX-position tile with the signed net position + direction", async () => {
    renderPage()
    expect(await screen.findByText("₦8,240.00")).toBeInTheDocument()
    expect(screen.getByText("FX position")).toBeInTheDocument()
    expect(screen.getByText("Net long USDT vs NGN")).toBeInTheDocument()
  })

  it("renders the exposure-headroom % from the FX-position endpoint", async () => {
    renderPage()
    // 7200 bps → 72%.
    expect(await screen.findByText("72%")).toBeInTheDocument()
    expect(screen.getByText("Exposure headroom")).toBeInTheDocument()
  })

  it("surfaces the top unacknowledged alert in the warning banner", async () => {
    renderPage()
    expect(
      await screen.findByText(
        /net exposure exceeds the configured inventory limit/i
      )
    ).toBeInTheDocument()
  })

  it("wires child-address sweeps from the sweep read model", async () => {
    renderPage()
    expect(
      await screen.findByText("TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt")
    ).toBeInTheDocument()
    // Real gas balance + lifecycle label.
    expect(screen.getByText("18.40 TRX")).toBeInTheDocument()
    expect(screen.getByText("Below threshold")).toBeInTheDocument()
    // Threshold footer from the endpoint.
    expect(screen.getByText("Sweep threshold")).toBeInTheDocument()
    expect(screen.getByText("25 TRX")).toBeInTheDocument()
  })

  it("wires the payout / withdrawal approval queue from real pending payouts", async () => {
    renderPage()
    expect(
      await screen.findByText("Kelechi Chukwu · GTBank")
    ).toBeInTheDocument()
    expect(screen.getByText("₦4,820,000.00")).toBeInTheDocument()
    // requiresApproval → maker-checker tag on exactly the large payout.
    expect(screen.getByText("Maker-checker")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2)
  })

  it("renders an empty sweeps state when the sweep feed is empty", async () => {
    mockSweeps.mockResolvedValue({
      items: [],
      sweepThreshold: "25",
      thresholdAsset: "TRX",
    })
    renderPage()
    expect(
      await screen.findByText(/No child addresses to sweep/i)
    ).toBeInTheDocument()
  })

  it("renders an empty payout queue when nothing is pending", async () => {
    mockPayouts.mockResolvedValue({ items: [] })
    renderPage()
    expect(
      await screen.findByText(/No payouts awaiting release/i)
    ).toBeInTheDocument()
  })

  it("hides the warning banner when there are no unacknowledged alerts", async () => {
    mockAlerts.mockResolvedValue({ items: [] })
    renderPage()
    await screen.findByText("412908.44")
    expect(screen.queryByText(/Exposure alert ·/i)).not.toBeInTheDocument()
  })

  it("renders the balances error branch with a retry affordance", async () => {
    mockBalances.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByText(/Failed to load treasury balances/i)
    ).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0)
  })

  it("renders the sweeps error branch independently", async () => {
    mockSweeps.mockRejectedValue(new Error("boom"))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/Failed to load sweeps/i)).toBeInTheDocument()
    )
  })

  it("renders the payout-queue error branch independently", async () => {
    mockPayouts.mockRejectedValue(new Error("boom"))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/Failed to load payout queue/i)).toBeInTheDocument()
    )
  })
})
