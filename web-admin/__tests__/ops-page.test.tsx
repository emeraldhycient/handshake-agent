/**
 * OpsPage (real-data wiring) tests — design §6.29.
 *
 * The "System / ops" board now reads `GET /admin/ops` via `useOps` → the mocked
 * `@/lib/api/ops` client; its provider tiles, webhook queues, and cron registry come
 * from the `OpsBoard` contract. These tests assert:
 *   • the loading → data branch renders the real provider / queue / job fields,
 *   • the derived display labels (latency "142ms", "Operational" / "Degraded" /
 *     "Draining" / "Backed up", relative "last run"),
 *   • the error branch, and
 *   • that each job's "Run now" affordance drives the wired flow (reason →
 *     engine-action → the REAL runOpsJob mutation) to the "Run started · <job>" toast
 *     (§3.1 — engine-brokered oversight; no funds move).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { OpsBoard } from "@handshake-agent/contracts"

import { OpsPage } from "@/components/admin/ops-page"
import { defaultToastStore } from "@/lib/store/toast-store"

vi.mock("@/lib/api/ops", () => ({
  getOpsBoard: vi.fn(),
  runOpsJob: vi.fn(),
}))

// The page reads the signed-in admin (mfaEnabled) via useAdminMe → admin.getMe.
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn().mockResolvedValue({ mfaEnabled: true, permissions: [] }),
}))

import { getOpsBoard, runOpsJob } from "@/lib/api/ops"

const mockBoard = vi.mocked(getOpsBoard)
const mockRun = vi.mocked(runOpsJob)

const BOARD: OpsBoard = {
  providers: [
    { key: "blockradar", name: "Blockradar", health: "ok", lastLatencyMs: 142 },
    {
      key: "flutterwave",
      name: "Flutterwave",
      health: "warn",
      lastLatencyMs: 890,
    },
    { key: "resend", name: "Resend", health: "ok", lastLatencyMs: null },
  ],
  webhookQueues: [
    { key: "blockradar.deposit", depth: 0, retries: 0, health: "ok" },
    { key: "whatsapp.inbound", depth: 12, retries: 4, health: "down" },
  ],
  jobs: [
    {
      id: "settlement-reconciliation",
      name: "Reconciliation sweep",
      schedule: "*/2 * * * *",
      lastRunAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      status: "ok",
      health: "ok",
    },
    {
      id: "statement-link-regen",
      name: "Statement-link regen",
      schedule: "0 0 * * *",
      lastRunAt: null,
      status: "idle",
      health: "ok",
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <OpsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockBoard.mockReset()
  mockRun.mockReset()
  defaultToastStore.setState({ toasts: [] })
})

describe("OpsPage", () => {
  it("renders provider tiles with derived latency + status labels", async () => {
    mockBoard.mockResolvedValue(BOARD)
    renderPage()

    // Provider name + the derived latency figure ("142ms") + status word.
    expect(await screen.findByText("Blockradar")).toBeInTheDocument()
    expect(screen.getByText("142ms")).toBeInTheDocument()
    expect(screen.getAllByText("Operational").length).toBeGreaterThan(0)
    // A degraded provider surfaces the "Degraded" word (colour is never the sole signal).
    expect(screen.getByText("Degraded")).toBeInTheDocument()
    // A provider with no observed dispatch shows an em dash, never a fabricated latency.
    expect(screen.getByText("—")).toBeInTheDocument()
  })

  it("renders webhook queues with real depth + retries + status", async () => {
    mockBoard.mockResolvedValue(BOARD)
    renderPage()

    expect(await screen.findByText("blockradar.deposit")).toBeInTheDocument()
    expect(screen.getByText("whatsapp.inbound")).toBeInTheDocument()
    // The backed-up queue's depth (12) + retries (4) + "Backed up" status render.
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByText("Backed up")).toBeInTheDocument()
  })

  it("renders the cron registry with schedule + relative last-run + status pill", async () => {
    mockBoard.mockResolvedValue(BOARD)
    renderPage()

    expect(await screen.findByText("Reconciliation sweep")).toBeInTheDocument()
    // Schedule + a relative "3m ago" label derived from lastRunAt.
    expect(screen.getByText(/\*\/2 \* \* \* \* · last 3m ago/)).toBeInTheDocument()
    // A never-run job shows "last never" + the "Idle" pill.
    expect(screen.getByText(/0 0 \* \* \* · last never/)).toBeInTheDocument()
    expect(screen.getByText("Idle")).toBeInTheDocument()
  })

  it("shows the error branch with a retry when the board fails to load", async () => {
    mockBoard.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText(/Couldn't load the ops board/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument()
  })

  it("shows the empty branch when nothing is registered", async () => {
    mockBoard.mockResolvedValue({ providers: [], webhookQueues: [], jobs: [] })
    renderPage()

    expect(
      await screen.findByText(/No providers, queues, or jobs registered/i)
    ).toBeInTheDocument()
  })

  it("fires the real runOpsJob mutation + toasts 'Run started' naming the job", async () => {
    mockBoard.mockResolvedValue(BOARD)
    mockRun.mockResolvedValue({
      jobId: "settlement-reconciliation",
      triggered: true,
      status: "running",
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: /Run Reconciliation sweep now/i })
    )

    // Reason (audit) leg — a reason is required to continue.
    await user.type(
      screen.getByLabelText("Reason"),
      "Manual reconciliation catch-up"
    )
    await user.click(screen.getByRole("button", { name: /Continue/ }))

    // Engine-action leg — trigger via engine fires the REAL mutation.
    await user.click(screen.getByRole("button", { name: "Trigger via engine" }))

    // The mutation is called with the job id + the captured reason.
    await waitFor(() => {
      expect(mockRun).toHaveBeenCalledTimes(1)
    })
    expect(mockRun).toHaveBeenCalledWith("settlement-reconciliation", {
      reason: "Manual reconciliation catch-up",
    })

    await waitFor(() => {
      const { toasts } = defaultToastStore.getState()
      expect(toasts).toHaveLength(1)
      expect(toasts[0].message).toMatch(/Run started/)
      expect(toasts[0].message).toMatch(/Reconciliation sweep/)
      expect(toasts[0].kind).toBe("info")
    })
  })

  it("surfaces a not-manually-triggerable job with a warn toast, no crash", async () => {
    mockBoard.mockResolvedValue(BOARD)
    mockRun.mockResolvedValue({
      jobId: "statement-link-regen",
      triggered: false,
      status: "idle",
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: /Run Statement-link regen now/i })
    )
    await user.type(screen.getByLabelText("Reason"), "try it")
    await user.click(screen.getByRole("button", { name: /Continue/ }))
    await user.click(screen.getByRole("button", { name: "Trigger via engine" }))

    await waitFor(() => {
      const { toasts } = defaultToastStore.getState()
      expect(toasts).toHaveLength(1)
      expect(toasts[0].message).toMatch(/not manually triggerable/i)
      expect(toasts[0].kind).toBe("warn")
    })
  })
})
