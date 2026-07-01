/**
 * ReconciliationPage tests (Phase 6b — the break list + cron status bar are LIVE).
 *
 * The display data comes from the admin reconciliation hooks: `useReconBreaks`
 * (provider-vs-ledger breaks) and `useReconStatus` (the cron status bar). The
 * `lib/api/reconciliation` client is mocked (no server); the tests cover loading →
 * data plus the empty and error branches. `next/navigation` is mocked for useRouter.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  ReconBreakListResponse,
  ReconStatus,
} from "@handshake-agent/contracts"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("@/lib/api/reconciliation", () => ({
  listReconBreaks: vi.fn(),
  getReconStatus: vi.fn(),
}))

import { ReconciliationPage } from "@/components/admin/reconciliation-page"
import { listReconBreaks, getReconStatus } from "@/lib/api/reconciliation"

const mockBreaks = vi.mocked(listReconBreaks)
const mockStatus = vi.mocked(getReconStatus)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BREAKS: ReconBreakListResponse = {
  items: [
    {
      id: "comp_1",
      kind: "over_credit",
      severity: "high",
      transactionId: "tx_9f2a41c7",
      asset: "USDT",
      delta: "+50.00",
      detail:
        "Ledger credited 50.00 USDT more than the provider confirmed. Excess is flagged for human action — never auto-debited.",
      status: "open",
      detectedAt: "2026-07-01T04:00:00.000Z",
    },
    {
      id: "outbox_2",
      kind: "missing_settlement",
      severity: "medium",
      transactionId: "tx_3b81e0d4",
      asset: "NGN",
      delta: "-185000.00",
      detail:
        "The provider settled 185000.00 NGN but the matching ledger entry has not posted.",
      status: "open",
      detectedAt: "2026-07-01T03:14:00.000Z",
    },
  ],
}

const STATUS: ReconStatus = {
  enabled: true,
  lastRunAt: "2026-07-01T04:00:00.000Z",
  nextRunAt: "2026-07-01T04:02:00.000Z",
  intervalSeconds: 120,
  openBreakCount: 2,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ReconciliationPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockBreaks.mockReset().mockResolvedValue(BREAKS)
  mockStatus.mockReset().mockResolvedValue(STATUS)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReconciliationPage (wired)", () => {
  it("renders the header always", () => {
    renderPage()
    expect(
      screen.getByRole("heading", { name: "Reconciliation" })
    ).toBeInTheDocument()
  })

  it("shows a loading skeleton before the breaks resolve", () => {
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText("tx_9f2a41c7")).not.toBeInTheDocument()
  })

  it("wires the break list from the real endpoint (kind label + tx + delta)", async () => {
    renderPage()
    // The over-credit break: display label, offending tx link, signed delta + asset.
    expect(await screen.findByText("Over-credit")).toBeInTheDocument()
    expect(screen.getByText("tx_9f2a41c7")).toBeInTheDocument()
    expect(screen.getByText("+50.00 USDT")).toBeInTheDocument()
    // The missing-settlement break renders its own row.
    expect(screen.getByText("Missing settlement")).toBeInTheDocument()
    expect(screen.getByText("-185000.00 NGN")).toBeInTheDocument()
  })

  it("wires the cron status bar with the open-break count from the endpoint", async () => {
    renderPage()
    // openBreakCount = 2 from the status endpoint.
    expect(await screen.findByText("2")).toBeInTheDocument()
    expect(screen.getByText(/open breaks/i)).toBeInTheDocument()
  })

  it("renders the empty state when there are no breaks", async () => {
    mockBreaks.mockResolvedValue({ items: [] })
    mockStatus.mockResolvedValue({ ...STATUS, openBreakCount: 0 })
    renderPage()
    expect(await screen.findByText("No open breaks")).toBeInTheDocument()
  })

  it("renders the breaks error branch with a retry affordance", async () => {
    mockBreaks.mockRejectedValue(new Error("boom"))
    renderPage()
    expect(
      await screen.findByText(/Failed to load reconciliation breaks/i)
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: "Retry" }).length
    ).toBeGreaterThan(0)
  })

  it("renders the status error branch independently of the break list", async () => {
    mockStatus.mockRejectedValue(new Error("boom"))
    renderPage()
    // The break list still renders from its own (successful) query.
    expect(await screen.findByText("Over-credit")).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load reconciliation status/i)
      ).toBeInTheDocument()
    )
  })
})
