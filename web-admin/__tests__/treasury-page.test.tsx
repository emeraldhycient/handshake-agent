/**
 * TreasuryPage tests (Phase 6a — wired to real read hooks).
 *
 * The display data now comes from the existing admin treasury hooks:
 * `useTreasuryBalances` (custodial hero), `useTreasuryExposure` (exposure tile),
 * `useTreasuryAlerts` (the warning banner), and `useWithdrawalPolicies` (child-address
 * sweep rows). The `lib/api/treasury` client is mocked (no server), and the tests
 * cover the loading → data branch plus the empty and error branches.
 *
 * Fields with no backend (NGN fiat float, FX position, payout queue, per-sweep balance
 * + status, the sweep threshold) stay design-faithful and are asserted as such.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  TreasuryAlertListResponse,
  TreasuryBalancesResponse,
  TreasuryExposureListResponse,
  WithdrawalPolicyListResponse,
} from "@handshake-agent/contracts"

import { TreasuryPage } from "@/components/admin/treasury-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/treasury", () => ({
  listTreasuryBalances: vi.fn(),
  listTreasuryExposure: vi.fn(),
  listTreasuryAlerts: vi.fn(),
  listWithdrawalPolicies: vi.fn(),
}))

import {
  listTreasuryBalances,
  listTreasuryExposure,
  listTreasuryAlerts,
  listWithdrawalPolicies,
} from "@/lib/api/treasury"

const mockBalances = vi.mocked(listTreasuryBalances)
const mockExposure = vi.mocked(listTreasuryExposure)
const mockAlerts = vi.mocked(listTreasuryAlerts)
const mockPolicies = vi.mocked(listWithdrawalPolicies)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BALANCES: TreasuryBalancesResponse = {
  balances: [
    {
      network: "TRON",
      asset: "USDT",
      totalAmount: "412908.44",
      walletCount: 12,
    },
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

const POLICIES: WithdrawalPolicyListResponse = {
  items: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      walletId: "TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt",
      maxWithdrawalPerTx: "1000.00",
      maxWithdrawalPerDay: "5000.00",
      requiresApproval: true,
      allowListMode: "off",
      enabledAt: "2026-06-01T00:00:00.000Z",
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
  mockPolicies.mockReset().mockResolvedValue(POLICIES)
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
    // The balance-card grid is in its aria-busy loading state on first paint.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    // No live custodial figure yet.
    expect(screen.queryByText("412908.44")).not.toBeInTheDocument()
  })

  it("wires the custodial hero from real aggregated balances", async () => {
    renderPage()

    // The USDT-on-TRON row drives the hero: value + "12 wallets · TRON" note.
    expect(await screen.findByText("412908.44")).toBeInTheDocument()
    expect(screen.getByText("Custodial · USDT")).toBeInTheDocument()
    expect(screen.getByText("12 wallets · TRON")).toBeInTheDocument()
  })

  it("surfaces the top unacknowledged alert in the warning banner", async () => {
    renderPage()

    expect(
      await screen.findByText(
        /net exposure exceeds the configured inventory limit/i
      )
    ).toBeInTheDocument()
  })

  it("wires child-address sweeps from the withdrawal-policy wallet ids", async () => {
    renderPage()

    // The wallet id is rendered as the sweep row address.
    expect(
      await screen.findByText("TJm4Yq8s2kPd9wR3vN7xL6bH1cF0gA5eZt")
    ).toBeInTheDocument()
    // The threshold footer is design-faithful.
    expect(screen.getByText("Sweep threshold")).toBeInTheDocument()
    expect(screen.getByText("25 TRX")).toBeInTheDocument()
  })

  it("keeps the design-faithful payout queue (mock, no backend)", async () => {
    renderPage()

    expect(
      screen.getByText("Payout / withdrawal approval queue")
    ).toBeInTheDocument()
    expect(screen.getByText("Kelechi Chukwu · GTBank")).toBeInTheDocument()
    expect(screen.getByText("Maker-checker")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(3)
  })

  it("renders an empty sweeps state when no withdrawal policies exist", async () => {
    mockPolicies.mockResolvedValue({ items: [] })
    renderPage()

    expect(
      await screen.findByText(/No child addresses under a withdrawal policy/i)
    ).toBeInTheDocument()
  })

  it("hides the warning banner when there are no unacknowledged alerts", async () => {
    mockAlerts.mockResolvedValue({ items: [] })
    renderPage()

    // Wait for the hero to resolve, then assert no exposure-alert banner.
    await screen.findByText("412908.44")
    expect(screen.queryByText(/Exposure alert ·/i)).not.toBeInTheDocument()
  })

  it("renders the balances error branch with a retry affordance", async () => {
    mockBalances.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText(/Failed to load treasury balances/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("renders the sweeps error branch independently", async () => {
    mockPolicies.mockRejectedValue(new Error("boom"))
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/Failed to load sweeps/i)).toBeInTheDocument()
    )
  })
})
