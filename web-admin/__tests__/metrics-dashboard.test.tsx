/**
 * MetricsDashboard tests.
 *
 *  1. Renders the summary cards from a mock DashboardSummary — asserts the
 *     success-rate % and the revenue currency/amount.
 *  2. Changing the range preset re-fetches — the api client is called again
 *     with the new (90-day) range window.
 *  3. The service-health section renders one row per service, each with a
 *     success-rate bar (role="img").
 *  4. When the revenue spread is empty, the revenue tile still renders (with a
 *     fee-revenue note) rather than erroring.
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
      { type: "buy", count: 120, completed: 110, failed: 10, stuck: 0 },
      { type: "send", count: 40, completed: 38, failed: 2, stuck: 0 },
    ],
    series: [
      { date: "2026-06-28", count: 12 },
      { date: "2026-06-29", count: 20 },
    ],
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
      {
        date: "2026-06-29",
        buy: 12,
        sell: 0,
        send: 8,
        swap: 0,
        ticket: 0,
        total: 20,
      },
    ],
    successRate: 0.925,
  },
  gmv: {
    totalByCurrency: [{ currency: "NGN", amount: "1250000.00" }],
    txnCount: 148,
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

    // Success rate (0.925 → 92.5%) appears in the KPI grid — as both the hero
    // delta chip and the dedicated "Success rate" tile value.
    const rates = await screen.findAllByText("92.5%")
    expect(rates.length).toBeGreaterThanOrEqual(1)
    // The primary revenue currency + amount (NGN 45000.00) render together.
    expect(screen.getByText("NGN 45000.00")).toBeInTheDocument()
    // Total transactions card (120 + 40 = 160).
    expect(screen.getByText("160")).toBeInTheDocument()
  })

  it("re-fetches with the new range when the preset changes", async () => {
    const user = userEvent.setup()
    renderDashboard()

    await screen.findAllByText("92.5%")
    expect(mockDashboard).toHaveBeenCalledTimes(1)
    // Default preset is 30 days → a 30-day-wide window.
    const firstRange = mockDashboard.mock.calls[0][0]
    expect(firstRange).toBeDefined()

    await user.click(screen.getByRole("button", { name: "90d" }))

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

    await screen.findAllByText("92.5%")
    // One labelled success-rate bar per service (role="img"); the bar's
    // aria-label carries the service name and its success-rate figure.
    expect(
      screen.getByRole("img", { name: /buy: 91\.6%/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("img", { name: /send: 95\.0%/i })
    ).toBeInTheDocument()
    // Per-service success rate captions.
    expect(screen.getByText("91.6%")).toBeInTheDocument()
    expect(screen.getByText("95.0%")).toBeInTheDocument()
  })

  it("surfaces that spread is folded into FX (not fabricated) on the revenue tile", async () => {
    // The fixture has an empty totalSpreadByCurrency; the revenue tile renders
    // its fee figure AND the honest disclosure that spread is not tracked
    // separately (revenue = fees only) — surfaced, never fabricated.
    renderDashboard()

    expect(await screen.findByText("Revenue (fees)")).toBeInTheDocument()
    expect(screen.getByText("NGN 45000.00")).toBeInTheDocument()
    // Two fee currencies in the fixture → a "+1 more currencies" note.
    expect(screen.getByText(/more currencies/i)).toBeInTheDocument()
    // The spread disclosure must be present.
    expect(screen.getByText(/spread folded into FX/i)).toBeInTheDocument()
  })
})
