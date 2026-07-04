/**
 * ReconRunHistoryPanel tests (Go-readiness #3) — the durable run-history + break
 * lifecycle panel. The `lib/api/reconciliation` history clients are mocked (no
 * server): run list (loading/empty/error/data), expanding a run to fetch its breaks,
 * and the acknowledge / resolve dispositions firing through the reason → mutation
 * chain. `@/lib/api/admin` getMe drives the StepUpDialog's mfa flag.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  PersistedReconBreak,
  ReconRunDetail,
  ReconRunListResponse,
} from "@handshake-agent/contracts"

vi.mock("@/lib/api/reconciliation", () => ({
  listReconRuns: vi.fn(),
  getReconRun: vi.fn(),
  acknowledgeReconRunBreak: vi.fn(),
  resolveReconRunBreak: vi.fn(),
}))

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn().mockResolvedValue({ mfaEnabled: true, permissions: [] }),
}))

import { ReconRunHistoryPanel } from "@/components/admin/recon-run-history"
import {
  listReconRuns,
  getReconRun,
  acknowledgeReconRunBreak,
  resolveReconRunBreak,
} from "@/lib/api/reconciliation"

const mockListRuns = vi.mocked(listReconRuns)
const mockGetRun = vi.mocked(getReconRun)
const mockAck = vi.mocked(acknowledgeReconRunBreak)
const mockResolve = vi.mocked(resolveReconRunBreak)

const DETECTED_BREAK: PersistedReconBreak = {
  id: "brk-1",
  reconRunId: "run-1",
  breakType: "over_credit",
  userId: "user-1",
  walletId: "wallet-1",
  outboxId: null,
  currency: "USDT",
  delta: "-50.5",
  status: "detected",
  approvedByAdminId: null,
  reason: null,
  actionAt: null,
  createdAt: "2026-07-04T04:00:00.000Z",
  updatedAt: "2026-07-04T04:00:00.000Z",
}

const RUNS: ReconRunListResponse = {
  items: [
    {
      id: "run-1",
      runType: "wallet_deposit",
      status: "completed",
      totalChecked: 3,
      breaksDetected: 1,
      startedAt: "2026-07-04T04:00:00.000Z",
      completedAt: "2026-07-04T04:00:03.000Z",
      createdAt: "2026-07-04T04:00:00.000Z",
    },
  ],
  nextCursor: null,
}

const RUN_DETAIL: ReconRunDetail = {
  run: RUNS.items[0],
  breaks: [DETECTED_BREAK],
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ReconRunHistoryPanel />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockListRuns.mockReset().mockResolvedValue(RUNS)
  mockGetRun.mockReset().mockResolvedValue(RUN_DETAIL)
  mockAck
    .mockReset()
    .mockResolvedValue({ ...DETECTED_BREAK, status: "acknowledged" })
  mockResolve
    .mockReset()
    .mockResolvedValue({ ...DETECTED_BREAK, status: "resolved" })
})

describe("ReconRunHistoryPanel", () => {
  it("lists persisted runs with their type + break count", async () => {
    renderPanel()
    await screen.findByText("Wallet deposit")
    expect(screen.getByText("3 checked")).toBeInTheDocument()
    expect(screen.getByText(/1 break/)).toBeInTheDocument()
  })

  it("renders the empty state when there are no runs", async () => {
    mockListRuns.mockResolvedValue({ items: [], nextCursor: null })
    renderPanel()
    await screen.findByText(/No reconciliation runs recorded yet/i)
  })

  it("renders an error branch when the run list fails", async () => {
    mockListRuns.mockRejectedValue(new Error("boom"))
    renderPanel()
    await screen.findByText(/Couldn’t load run history/i)
  })

  it("expands a run to reveal its detected breaks (lazily fetched)", async () => {
    const user = userEvent.setup()
    renderPanel()
    const runButton = await screen.findByRole("button", {
      name: /Wallet deposit/,
    })
    // Breaks are not fetched until expand.
    expect(mockGetRun).not.toHaveBeenCalled()

    await user.click(runButton)

    await screen.findByText("Over-credit")
    expect(mockGetRun).toHaveBeenCalledWith("run-1")
    expect(screen.getByText(/-50\.5 USDT/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument()
  })

  it("resolves a break through the reason → mutation chain", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(
      await screen.findByRole("button", { name: /Wallet deposit/ })
    )
    await user.click(await screen.findByRole("button", { name: "Resolve" }))

    // Reason (audit) leg, then Continue fires the disposition.
    await user.type(
      await screen.findByLabelText("Reason"),
      "Confirmed lagged provider balance"
    )
    await user.click(screen.getByRole("button", { name: /Continue/ }))

    await waitFor(() =>
      expect(mockResolve).toHaveBeenCalledWith(
        "brk-1",
        "Confirmed lagged provider balance"
      )
    )
    expect(mockAck).not.toHaveBeenCalled()
  })

  it("acknowledges a break through the reason → mutation chain", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(
      await screen.findByRole("button", { name: /Wallet deposit/ })
    )
    await user.click(await screen.findByRole("button", { name: "Acknowledge" }))

    await user.type(await screen.findByLabelText("Reason"), "Investigating")
    await user.click(screen.getByRole("button", { name: /Continue/ }))

    await waitFor(() =>
      expect(mockAck).toHaveBeenCalledWith("brk-1", "Investigating")
    )
    expect(mockResolve).not.toHaveBeenCalled()
  })
})
