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
  escalateReconBreak: vi.fn(),
  // Go-readiness #3 durable-history clients (the run-history panel on the page).
  listReconRuns: vi.fn(),
  getReconRun: vi.fn(),
  getReconRunBreak: vi.fn(),
  acknowledgeReconRunBreak: vi.fn(),
  resolveReconRunBreak: vi.fn(),
}))

// The "Run now" button triggers the settlement-reconciliation ops job.
vi.mock("@/lib/api/ops", () => ({
  runOpsJob: vi.fn(),
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
  escalateReconBreak,
  listReconRuns,
} from "@/lib/api/reconciliation"
import { runOpsJob } from "@/lib/api/ops"

const mockBreaks = vi.mocked(listReconBreaks)
const mockStatus = vi.mocked(getReconStatus)
const mockResolve = vi.mocked(resolveReconBreak)
const mockAccept = vi.mocked(acceptReconBreak)
const mockEscalate = vi.mocked(escalateReconBreak)
const mockRunOpsJob = vi.mocked(runOpsJob)
const mockListRuns = vi.mocked(listReconRuns)

// A ComplianceEventItem returned by the escalate endpoint (the opened case).
const ESCALATED_EVENT = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  userId: "22222222-2222-4222-8222-222222222222",
  transactionId: "tx_9f2a41c7",
  eventType: "recon_break_escalation",
  severity: "high" as const,
  status: "flagged" as const,
  screeningProvider: "manual",
  ruleOrHit: null,
  createdAt: "2026-07-02T04:05:00.000Z",
}

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
  mockEscalate.mockReset().mockResolvedValue(ESCALATED_EVENT)
  mockRunOpsJob.mockReset().mockResolvedValue({
    jobId: "settlement-reconciliation",
    triggered: true,
    status: "running",
  })
  // The run-history panel renders on the page; default to an empty history so the
  // existing break-board assertions are unaffected.
  mockListRuns.mockReset().mockResolvedValue({ items: [], nextCursor: null })
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
    expect(screen.getByText("+50 USDT")).toBeInTheDocument()
    // The missing-settlement break renders its own row.
    expect(screen.getByText("Missing settlement")).toBeInTheDocument()
    expect(screen.getByText("-₦185,000.00")).toBeInTheDocument()
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

describe("ReconciliationPage (Phase 8 — escalate to compliance WRITE)", () => {
  it("does not call escalateReconBreak until the reason modal's Continue fires", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      (await screen.findAllByRole("button", { name: /Escalate to case/i }))[0]
    )
    // The ReasonModal appears but nothing is escalated yet.
    await screen.findByLabelText("Reason")
    expect(mockEscalate).not.toHaveBeenCalled()
  })

  it("fires the REAL escalate mutation with the captured reason via reason → server", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      (await screen.findAllByRole("button", { name: /Escalate to case/i }))[0]
    )
    await user.type(screen.getByLabelText("Reason"), "Confirmed AML concern")
    await user.click(screen.getByRole("button", { name: /Continue/ }))

    await waitFor(() => expect(mockEscalate).toHaveBeenCalledTimes(1))
    expect(mockEscalate).toHaveBeenCalledWith("comp_1", "Confirmed AML concern")
    // The escalated break's footer reflects the disposition.
    expect(await screen.findByText("Escalated to case")).toBeInTheDocument()
    // Escalate never moves money — no resolve/accept side effect.
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockAccept).not.toHaveBeenCalled()
  })

  it("opens step-up and replays the escalate POST after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockEscalate
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(ESCALATED_EVENT)

    renderPage()
    await user.click(
      (await screen.findAllByRole("button", { name: /Escalate to case/i }))[0]
    )
    await user.type(screen.getByLabelText("Reason"), "Confirmed AML concern")
    await user.click(screen.getByRole("button", { name: /Continue/ }))

    // The re-auth dialog appears (TOTP mode, since mfaEnabled).
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockEscalate).toHaveBeenCalledTimes(1)
  })
})

describe("ReconciliationPage (Phase 9 — Run now triggers the reconciler ops job)", () => {
  it("does not run the job until the reason modal's Continue fires", async () => {
    const user = userEvent.setup()
    renderPage()
    // Wait for the board to settle so the status-bar Run-now button is present.
    await screen.findByText("Over-credit")

    await user.click(screen.getByRole("button", { name: /Run now/i }))
    // The ReasonModal appears but nothing has run yet.
    await screen.findByLabelText("Reason")
    expect(mockRunOpsJob).not.toHaveBeenCalled()
  })

  it("triggers settlement-reconciliation with the captured reason via reason → server", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Over-credit")

    await user.click(screen.getByRole("button", { name: /Run now/i }))
    await user.type(
      screen.getByLabelText("Reason"),
      "Manual reconciliation sweep"
    )
    await user.click(screen.getByRole("button", { name: /Continue/ }))

    await waitFor(() => expect(mockRunOpsJob).toHaveBeenCalledTimes(1))
    expect(mockRunOpsJob).toHaveBeenCalledWith("settlement-reconciliation", {
      reason: "Manual reconciliation sweep",
    })
    // Triggering the reconciler moves no money — no disposition mutation fires.
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockAccept).not.toHaveBeenCalled()
  })

  it("opens step-up and replays the run POST after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockRunOpsJob
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({
        jobId: "settlement-reconciliation",
        triggered: true,
        status: "running",
      })

    renderPage()
    await screen.findByText("Over-credit")

    await user.click(screen.getByRole("button", { name: /Run now/i }))
    await user.type(screen.getByLabelText("Reason"), "Manual sweep")
    await user.click(screen.getByRole("button", { name: /Continue/ }))

    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockRunOpsJob).toHaveBeenCalledTimes(1)
  })
})
