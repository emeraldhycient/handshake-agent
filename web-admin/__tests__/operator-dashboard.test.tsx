/**
 * OperatorDashboard tests.
 *
 * The KPI tiles + the 24h/7d/30d range switcher are wired to the real composite
 * metrics endpoint (`useDashboardMetrics` → `getDashboardMetrics`); the volume chart,
 * system-health, live-activity, and approvals widgets stay mock (Phase 6b). These
 * tests assert:
 *
 *  1. Data branch — the KPI tiles render from a mocked DashboardSummary (derived
 *     totals: transaction count, revenue currency/amount, new signups, KYC pending,
 *     failed tx), and GMV/open-cases (no backend) render "—".
 *  2. Range switcher — changing the preset re-fetches with a wider window.
 *  3. Error branch — a failed metrics fetch shows the error panel with a Retry.
 *  4. The (still-mock) volume chart rescopes when the range switches.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { DashboardSummary } from "@handshake-agent/contracts"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/lib/api/metrics", () => ({
  getDashboardMetrics: vi.fn(),
}))

import { getDashboardMetrics } from "@/lib/api/metrics"
import { OperatorDashboard } from "@/components/admin/operator-dashboard"

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
    totalFeesByCurrency: [{ currency: "NGN", amount: "45000.00" }],
    totalSpreadByCurrency: [],
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

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <OperatorDashboard />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockDashboard.mockReset()
  mockDashboard.mockResolvedValue(SUMMARY)
})

// ─── Snapshot the mock chart's segment heights (inline `height:` styles). ──────────
function chartHeights(): string {
  const chart = screen.getByRole("img", {
    name: /Transaction volume by day/i,
  })
  return Array.from(chart.querySelectorAll<HTMLElement>("[style*='height']"))
    .map((el) => el.style.height)
    .join("|")
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OperatorDashboard — KPI tiles wired to metrics", () => {
  it("renders KPI tiles from the mocked summary (loading → data)", async () => {
    renderDashboard()

    // Transaction count (120 + 40 = 160) — shown on both the hero volume tile
    // and the Transactions tile.
    const counts = await screen.findAllByText("160")
    expect(counts.length).toBeGreaterThanOrEqual(1)
    // Revenue (fees): the primary currency + amount from the contract.
    expect(screen.getByText("NGN 45000.00")).toBeInTheDocument()
    // New signups = activeUsers.newInRange (14).
    expect(screen.getByText("14")).toBeInTheDocument()
    // KYC pending = pending (25) + needs_info (5) = 30.
    expect(screen.getByText("30")).toBeInTheDocument()
    // Failed / stuck tx = sum of byType.failed (10 + 2 = 12).
    expect(screen.getByText("12")).toBeInTheDocument()
  })

  it("renders '—' for the KPIs with no backend (GMV, open compliance cases)", async () => {
    renderDashboard()

    await screen.findByText("NGN 45000.00")
    // GMV and Open compliance cases have no metric to source → both render "—".
    expect(screen.getByText("GMV")).toBeInTheDocument()
    expect(screen.getByText("Open compliance cases")).toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2)
  })

  it("re-fetches with a wider window when the range preset changes", async () => {
    const user = userEvent.setup()
    renderDashboard()

    await screen.findByText("NGN 45000.00")
    expect(mockDashboard).toHaveBeenCalledTimes(1)
    const firstRange = mockDashboard.mock.calls[0][0] as { from: string }

    await user.click(screen.getByRole("button", { name: "30d" }))

    await waitFor(() => expect(mockDashboard).toHaveBeenCalledTimes(2))
    const secondRange = mockDashboard.mock.calls[1][0] as { from: string }
    // The 30-day window starts strictly earlier than the 24h (today-only) window.
    expect(secondRange.from < firstRange.from).toBe(true)
  })

  it("shows an error panel with a Retry when the metrics fetch fails", async () => {
    mockDashboard.mockRejectedValue(new Error("boom"))
    renderDashboard()

    expect(
      await screen.findByText("Failed to load metrics")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("rescopes the (mock) volume chart when the range switches", async () => {
    const user = userEvent.setup()
    renderDashboard()

    await screen.findByText("NGN 45000.00")
    const before = chartHeights()
    expect(before.length).toBeGreaterThan(0)

    await user.click(screen.getByRole("button", { name: "7d" }))
    const after7d = chartHeights()
    expect(after7d).not.toEqual(before)

    await user.click(screen.getByRole("button", { name: "30d" }))
    const after30d = chartHeights()
    expect(after30d).not.toEqual(after7d)
  })
})
