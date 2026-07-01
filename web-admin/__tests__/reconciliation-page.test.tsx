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
import userEvent from "@testing-library/user-event"
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
  resolveReconBreak: vi.fn(),
  acceptReconBreak: vi.fn(),
}))

// useAdminMe (mfaEnabled) drives the StepUpDialog rendered by the page.
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn().mockResolvedValue({ mfaEnabled: true, permissions: [] }),
}))

import { ReconciliationPage } from "@/components/admin/reconciliation-page"
import {
  listReconBreaks,
  getReconStatus,
  resolveReconBreak,
  acceptReconBreak,
} from "@/lib/api/reconciliation"

const mockBreaks = vi.mocked(listReconBreaks)
const mockStatus = vi.mocked(getReconStatus)
const mockResolve = vi.mocked(resolveReconBreak)
const mockAccept = vi.mocked(acceptReconBreak)

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
  mockResolve.mockReset().mockResolvedValue({
    breakId: "comp_1",
    disposition: "resolved",
    moved: false,
  })
  mockAccept.mockReset().mockResolvedValue({
    breakId: "comp_1",
    disposition: "accepted",
    moved: false,
  })
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

  it("fires the REAL resolve mutation via reason → engine-action (never a debit)", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      (await screen.findAllByRole("button", { name: /Resolve via engine/i }))[0]
    )
    // Reason (audit) leg.
    await user.type(screen.getByLabelText("Reason"), "Webhook replayed")
    await user.click(screen.getByRole("button", { name: /Continue/ }))
    // Engine-action leg → the REAL resolve mutation fires (engine-brokered).
    await user.click(
      screen.getByRole("button", { name: /Resolve via engine/i })
    )

    await waitFor(() => {
      expect(mockResolve).toHaveBeenCalledTimes(1)
    })
    expect(mockResolve).toHaveBeenCalledWith("comp_1", {
      reason: "Webhook replayed",
    })
    // The resolved break's footer reflects the disposition.
    expect(await screen.findByText("Resolved")).toBeInTheDocument()
  })

  it("fires the REAL accept mutation via reason → maker-checker (no debit)", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      (await screen.findAllByRole("button", { name: /^Accept$/ }))[0]
    )
    await user.type(screen.getByLabelText("Reason"), "Rounding drift")
    await user.click(screen.getByRole("button", { name: /Continue/ }))
    // Maker-checker submit → the REAL accept mutation fires.
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/i })
    )

    await waitFor(() => {
      expect(mockAccept).toHaveBeenCalledTimes(1)
    })
    expect(mockAccept).toHaveBeenCalledWith("comp_1", {
      reason: "Rounding drift",
    })
    expect(mockResolve).not.toHaveBeenCalled()
  })
})
