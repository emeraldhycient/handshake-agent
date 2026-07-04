/**
 * OperatorDashboard tests.
 *
 * The KPI tiles + the 24h/7d/30d range switcher are wired to the composite metrics
 * endpoint (`useDashboardMetrics` → `getDashboardMetrics`); the System-health card,
 * Live-activity feed, and Open-compliance KPI are wired to the ops endpoint
 * (`useMetricsOps` → `getMetricsOps`); the volume chart is wired to the composite
 * stacked series; the Approvals-awaiting-me panel is wired to the real maker-checker
 * inbox (`useApprovalsInbox` → `getApprovalsInbox`). These tests assert:
 *
 *  1. Data branch — the KPI tiles render from a mocked DashboardSummary (derived
 *     totals) and GMV; open-compliance renders from the ops payload.
 *  2. Range switcher — changing the preset re-fetches with a wider window.
 *  3. Error branch — a failed metrics fetch shows the error panel with a Retry.
 *  4. The volume chart rescopes when the range switches.
 *  5. Ops panels — system health rows (provider + observed latency + queue/recon)
 *     and the activity feed render from the mocked MetricsOps.
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { DashboardSummary, MetricsOps } from "@handshake-agent/contracts"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/lib/api/metrics", () => ({
  getDashboardMetrics: vi.fn(),
  getMetricsOps: vi.fn(),
}))

// The Approvals-awaiting-me panel reads the real inbox; keep the dashboard tests
// hermetic by defaulting it to an empty inbox (its own wiring is covered by
// approvals-page.test.tsx).
vi.mock("@/lib/api/approvals", () => ({
  getApprovalsInbox: vi.fn(),
}))

import { getDashboardMetrics, getMetricsOps } from "@/lib/api/metrics"
import { getApprovalsInbox } from "@/lib/api/approvals"
import { OperatorDashboard } from "@/components/admin/operator-dashboard"

const mockDashboard = vi.mocked(getDashboardMetrics)
const mockOps = vi.mocked(getMetricsOps)
const mockApprovalsInbox = vi.mocked(getApprovalsInbox)

// ─── Fixture ──────────────────────────────────────────────────────────────────

const SUMMARY: DashboardSummary = {
  txnVolume: {
    byType: [
      { type: "buy", count: 120, completed: 110, failed: 10, stuck: 3 },
      { type: "send", count: 40, completed: 38, failed: 2, stuck: 1 },
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

const OPS: MetricsOps = {
  systemHealth: {
    providers: [
      {
        key: "blockradar",
        name: "Blockradar",
        note: "Custodial WaaS · TRON",
        status: "ok",
        lastLatencyMs: 120,
      },
      {
        key: "flutterwave",
        name: "Flutterwave",
        note: "NGN rails",
        status: "degraded",
        lastLatencyMs: null,
      },
    ],
    webhookQueueDepth: 3,
    reconDriftCount: 2,
  },
  activityFeed: [
    {
      id: "tx_1",
      kind: "settled",
      title: "Buy settled",
      meta: "tx_1 · 120.00 USDT",
      at: new Date(Date.now() - 2 * 60_000).toISOString(),
    },
    {
      id: "audit_1",
      kind: "config_change",
      title: "Config change",
      meta: "crypto.buy.spreadBps",
      at: new Date(Date.now() - 34 * 60_000).toISOString(),
    },
  ],
  compliance: { openCases: 7 },
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
  mockOps.mockReset()
  mockOps.mockResolvedValue(OPS)
  mockApprovalsInbox.mockReset()
  mockApprovalsInbox.mockResolvedValue({
    awaitingMe: [],
    myRequests: [],
    counts: { awaitingMe: 0, myRequests: 0, myPending: 0 },
  })
})

// ─── Snapshot the real chart's segment heights (inline `height:` styles). ──────────
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
    expect(screen.getByText("₦45,000.00")).toBeInTheDocument()
    // New signups = activeUsers.newInRange (14).
    expect(screen.getByText("14")).toBeInTheDocument()
    // KYC pending = pending (25) + needs_info (5) = 30.
    expect(screen.getByText("30")).toBeInTheDocument()
    // Failed · stuck tx = failed (10 + 2 = 12) · stuck (3 + 1 = 4).
    expect(screen.getByText("12 · 4")).toBeInTheDocument()
  })

  it("renders the GMV tile and the open-compliance count from the ops metric", async () => {
    renderDashboard()

    await screen.findByText("₦45,000.00")
    // GMV is wired: the primary currency + summed fiat notional render.
    expect(screen.getByText("GMV")).toBeInTheDocument()
    expect(screen.getByText("₦1,250,000.00")).toBeInTheDocument()
    // Open compliance cases is now wired to the ops payload (openCases: 7).
    expect(screen.getByText("Open compliance cases")).toBeInTheDocument()
    expect(await screen.findByText("7")).toBeInTheDocument()
  })

  it("requests a non-empty 24h window that includes now (regression: today's txns were excluded)", async () => {
    renderDashboard()
    await screen.findByText("₦45,000.00")

    const range = mockDashboard.mock.calls[0][0] as { from: string; to: string }
    // The 24h preset must be a REAL window — the old bug truncated both bounds to a
    // date string, so `from === to` (zero-width) and nothing ever matched.
    expect(range.from < range.to).toBe(true)
    // `to` must carry the current time-of-day, not be floored to midnight-of-today
    // (which excluded everything created today). It should be within seconds of now.
    const toMs = new Date(range.to).getTime()
    expect(Number.isNaN(toMs)).toBe(false)
    expect(Date.now() - toMs).toBeLessThan(60_000)
    // The 24h window spans roughly a day back (not zero, not the 30-day default).
    const spanMs = toMs - new Date(range.from).getTime()
    expect(spanMs).toBeGreaterThan(23 * 60 * 60_000)
    expect(spanMs).toBeLessThan(25 * 60 * 60_000)
  })

  it("re-fetches with a wider window when the range preset changes", async () => {
    const user = userEvent.setup()
    renderDashboard()

    await screen.findByText("₦45,000.00")
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

  it("renders the volume chart from the real stacked-by-capability series", async () => {
    renderDashboard()

    await screen.findByText("₦45,000.00")
    // The chart is now backed by txnVolume.stackedSeries (2 day-buckets in the
    // fixture) — its bar segments render non-zero inline heights.
    const heights = chartHeights()
    expect(heights.length).toBeGreaterThan(0)
    // The tallest day (2026-06-29, total 20) normalises to a 100% bar column.
    expect(heights).toContain("100%")
  })

  it("re-renders the volume chart when the range fetch returns a different series", async () => {
    const user = userEvent.setup()
    // First (24h) call → the base fixture; the 30d call → a single, different day.
    const wideSummary: DashboardSummary = {
      ...SUMMARY,
      txnVolume: {
        ...SUMMARY.txnVolume,
        stackedSeries: [
          {
            date: "2026-06-01",
            buy: 50,
            sell: 30,
            send: 0,
            swap: 0,
            ticket: 0,
            total: 80,
          },
        ],
      },
    }
    mockDashboard.mockResolvedValueOnce(SUMMARY).mockResolvedValueOnce(wideSummary)

    renderDashboard()
    await screen.findByText("₦45,000.00")
    const before = chartHeights()

    await user.click(screen.getByRole("button", { name: "30d" }))
    await waitFor(() => expect(mockDashboard).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(chartHeights()).not.toEqual(before))
  })

  it("shows an empty-state note when the range has no transactions", async () => {
    mockDashboard.mockResolvedValue({
      ...SUMMARY,
      txnVolume: { ...SUMMARY.txnVolume, stackedSeries: [] },
    })
    renderDashboard()

    expect(
      await screen.findByText("No transactions in this range.")
    ).toBeInTheDocument()
  })
})

describe("OperatorDashboard — System health + Live activity wired to ops", () => {
  it("renders provider rows with observed latency (and — when unmeasured)", async () => {
    renderDashboard()

    // Blockradar row + its observed latency; Flutterwave has null latency → "—".
    expect(await screen.findByText("Blockradar")).toBeInTheDocument()
    expect(screen.getByText("120ms")).toBeInTheDocument()
    expect(screen.getByText("Flutterwave")).toBeInTheDocument()
    // Webhook-queue depth (3) + recon drift ("2 open") from the ops payload.
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("2 open")).toBeInTheDocument()
  })

  it("renders the activity feed rows from the ops payload", async () => {
    renderDashboard()

    expect(await screen.findByText("Buy settled")).toBeInTheDocument()
    expect(screen.getByText("tx_1 · 120.00 USDT")).toBeInTheDocument()
    expect(screen.getByText("Config change")).toBeInTheDocument()
  })

  it("shows an empty-state note when the activity feed is empty", async () => {
    mockOps.mockResolvedValue({ ...OPS, activityFeed: [] })
    renderDashboard()

    expect(
      await screen.findByText("No recent activity.")
    ).toBeInTheDocument()
  })

  it("shows an unavailable note when the ops fetch fails (panels degrade independently)", async () => {
    mockOps.mockRejectedValue(new Error("boom"))
    renderDashboard()

    // The composite dashboard still renders (independent query); the ops panels
    // fall back to their unavailable notes.
    await screen.findByText("₦45,000.00")
    expect(
      await screen.findByText("Health metrics unavailable.")
    ).toBeInTheDocument()
    expect(screen.getByText("Activity feed unavailable.")).toBeInTheDocument()
  })
})
