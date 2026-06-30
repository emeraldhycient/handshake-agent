/**
 * MetricsDashboard tests.
 *
 *  1. Renders the summary cards from a mock DashboardSummary — asserts the
 *     success-rate % and a revenue currency row.
 *  2. Changing the range preset re-fetches — the api client is called again
 *     with the new (90-day) range window.
 *  3. The service-health table renders one row per service, each with a
 *     success-rate bar (role="img").
 *  4. When the revenue spread is empty, the "folded into FX" note shows.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { DashboardSummary } from "@handshake-agent/contracts"

import { MetricsDashboard } from "@/components/admin/metrics-dashboard"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/metrics", () => ({
  getDashboardMetrics: vi.fn(),
}))

import { getDashboardMetrics } from "@/lib/api/metrics"

const mockDashboard = vi.mocked(getDashboardMetrics)

// ─── Fixture ──────────────────────────────────────────────────────────────────

const SUMMARY: DashboardSummary = {
  txnVolume: {
    byType: [
      { type: "buy", count: 120, completed: 110, failed: 10 },
      { type: "send", count: 40, completed: 38, failed: 2 },
    ],
    series: [
      { date: "2026-06-28", count: 12 },
      { date: "2026-06-29", count: 20 },
    ],
    successRate: 0.925,
  },
  revenue: {
    totalFeesByCurrency: [
      { currency: "NGN", amount: "45000.00" },
      { currency: "USD", amount: "120.50" },
    ],
    totalSpreadByCurrency: [],
    txnCount: 148,
  },
  kycFunnel: {
    byStatus: [
      { status: "approved", count: 300 },
      { status: "pending", count: 25 },
    ],
    byTier: [
      { tier: "tier_1", count: 200 },
      { tier: "tier_2", count: 125 },
    ],
  },
  activeUsers: { activeInRange: 88, newInRange: 14, totalUsers: 325 },
  serviceHealth: {
    services: [
      {
        service: "buy",
        total: 120,
        completed: 110,
        failed: 10,
        successRate: 0.916,
      },
      {
        service: "send",
        total: 40,
        completed: 38,
        failed: 2,
        successRate: 0.95,
      },
    ],
  },
}

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MetricsDashboard />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockDashboard.mockReset()
  mockDashboard.mockResolvedValue(SUMMARY)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MetricsDashboard", () => {
  it("renders summary cards: success rate % and a revenue currency row", async () => {
    renderDashboard()

    // Success rate card (0.925 → 92.5%).
    expect(await screen.findByText("92.5%")).toBeInTheDocument()
    // A revenue currency row.
    expect(screen.getByText("NGN")).toBeInTheDocument()
    expect(screen.getByText("45000.00")).toBeInTheDocument()
    // Total transactions card (120 + 40 = 160).
    expect(screen.getByText("160")).toBeInTheDocument()
  })

  it("re-fetches with the new range when the preset changes", async () => {
    const user = userEvent.setup()
    renderDashboard()

    await screen.findByText("92.5%")
    expect(mockDashboard).toHaveBeenCalledTimes(1)
    // Default preset is 30 days → a 30-day-wide window.
    const firstRange = mockDashboard.mock.calls[0][0]
    expect(firstRange).toBeDefined()

    await user.click(screen.getByRole("button", { name: "Last 90 days" }))

    await waitFor(() => expect(mockDashboard).toHaveBeenCalledTimes(2))
    const secondRange = mockDashboard.mock.calls[1][0] as {
      from: string
      to: string
    }
    // The 90-day window starts strictly earlier than the 30-day window.
    const firstFrom = (firstRange as { from: string }).from
    expect(secondRange.from < firstFrom).toBe(true)
  })

  it("renders a service-health row per service with a success-rate bar", async () => {
    renderDashboard()

    await screen.findByText("92.5%")
    // One labelled success-rate bar per service (role="img").
    expect(
      screen.getByRole("img", { name: /buy success rate/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("img", { name: /send success rate/i })
    ).toBeInTheDocument()
    // Per-service success rate captions.
    expect(screen.getByText("91.6%")).toBeInTheDocument()
    expect(screen.getByText("95.0%")).toBeInTheDocument()
  })

  it("shows the 'folded into FX' note when the revenue spread is empty", async () => {
    renderDashboard()

    expect(
      await screen.findByText(/spread folded into fx/i)
    ).toBeInTheDocument()
  })
})
