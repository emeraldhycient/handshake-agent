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
import type {
  BackfillRunStatusDto,
  DashboardSummary,
  OpsBoard,
} from "@handshake-agent/contracts"

import { OpsPage } from "@/components/admin/ops-page"
import { defaultToastStore } from "@/lib/store/toast-store"

vi.mock("@/lib/api/ops", () => ({
  getOpsBoard: vi.fn(),
  runOpsJob: vi.fn(),
  enqueueBackfill: vi.fn(),
  getBackfillRun: vi.fn(),
}))

// The service-health card reuses useDashboardMetrics → metrics.getDashboardMetrics.
vi.mock("@/lib/api/metrics", () => ({
  getDashboardMetrics: vi.fn(),
}))

// The page reads the signed-in admin (mfaEnabled) via useAdminMe → admin.getMe.
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn().mockResolvedValue({ mfaEnabled: true, permissions: [] }),
}))

import {
  enqueueBackfill,
  getBackfillRun,
  getOpsBoard,
  runOpsJob,
} from "@/lib/api/ops"
import { getDashboardMetrics } from "@/lib/api/metrics"

const mockBoard = vi.mocked(getOpsBoard)
const mockRun = vi.mocked(runOpsJob)
const mockEnqueue = vi.mocked(enqueueBackfill)
const mockRunStatus = vi.mocked(getBackfillRun)
const mockDashboard = vi.mocked(getDashboardMetrics)

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

// A minimal DashboardSummary whose serviceHealth block drives the health card;
// the other metric blocks are unused by OpsPage but the contract requires them.
const SERVICE_HEALTH: DashboardSummary = {
  txnVolume: { byType: [], series: [], stackedSeries: [], successRate: 1 },
  gmv: { totalByCurrency: [], txnCount: 0 },
  revenue: {
    totalFeesByCurrency: [],
    totalSpreadByCurrency: [],
    totalProfitByCurrency: [],
    txnCount: 0,
  },
  kycFunnel: { byStatus: [], byTier: [] },
  activeUsers: { activeInRange: 0, newInRange: 0, totalUsers: 0 },
  serviceHealth: {
    services: [
      { service: "buy", total: 200, completed: 198, failed: 2, successRate: 0.99 },
      { service: "send", total: 200, completed: 190, failed: 10, successRate: 0.95 },
    ],
  },
}

function backfillRun(
  over: Partial<BackfillRunStatusDto> = {}
): BackfillRunStatusDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "running",
    dryRun: false,
    totalUsers: 1000,
    scannedUsers: 400,
    perNetwork: {},
    failures: [],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    ...over,
  }
}

beforeEach(() => {
  mockBoard.mockReset()
  mockRun.mockReset()
  mockEnqueue.mockReset()
  mockRunStatus.mockReset()
  mockDashboard.mockReset()
  // Safe defaults so the always-present service-health card doesn't hang the
  // existing board tests; backfill polling only fires once a run is enqueued.
  mockDashboard.mockResolvedValue(SERVICE_HEALTH)
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

describe("OpsPage — service health card", () => {
  it("renders per-service success + error rate with a status word (colour never the sole signal)", async () => {
    mockBoard.mockResolvedValue(BOARD)
    renderPage()

    // The card heading + one row per service (await the async data branch).
    expect(await screen.findByText("Service health")).toBeInTheDocument()
    expect(await screen.findByText("buy")).toBeInTheDocument()
    expect(screen.getByText("send")).toBeInTheDocument()

    // Success rate is surfaced as a percentage (0.99 → "99.0%").
    expect(screen.getByText("99.0%")).toBeInTheDocument()
    // The complementary error rate is derived (0.95 success → 5.0% error).
    expect(screen.getByText(/5\.0% errors/)).toBeInTheDocument()

    // An elevated-error service carries an explicit status WORD, not just a colour.
    expect(screen.getByText("Elevated errors")).toBeInTheDocument()
    // A high-success service reads "Nominal".
    expect(screen.getByText("Nominal")).toBeInTheDocument()
    // The completed / failed counts render (colour + text).
    expect(screen.getByText(/198 completed/)).toBeInTheDocument()
    expect(screen.getByText(/10 failed/)).toBeInTheDocument()
  })

  it("shows the service-health error branch when the metrics feed fails", async () => {
    mockBoard.mockResolvedValue(BOARD)
    mockDashboard.mockRejectedValue(new Error("nope"))
    renderPage()

    expect(
      await screen.findByText(/Couldn't load service health/i)
    ).toBeInTheDocument()
  })

  it("shows the service-health empty branch when no service has activity", async () => {
    mockBoard.mockResolvedValue(BOARD)
    mockDashboard.mockResolvedValue({
      ...SERVICE_HEALTH,
      serviceHealth: { services: [] },
    })
    renderPage()

    expect(
      await screen.findByText(/No service activity in the last 30 days/i)
    ).toBeInTheDocument()
  })
})

describe("OpsPage — wallet backfill panel", () => {
  it("enqueues a backfill then polls the run to a terminal completed state", async () => {
    mockBoard.mockResolvedValue(BOARD)
    mockEnqueue.mockResolvedValue({
      runId: "11111111-1111-4111-8111-111111111111",
    })
    // First poll: running (400/1000); second: completed.
    mockRunStatus
      .mockResolvedValueOnce(backfillRun({ status: "running", scannedUsers: 400 }))
      .mockResolvedValue(
        backfillRun({
          status: "completed",
          scannedUsers: 1000,
          completedAt: new Date().toISOString(),
        })
      )
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: /Backfill wallet networks/i })
    )

    // The enqueue mutation fired; polling begins on the returned runId.
    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledTimes(1)
    })

    // Live progress renders while running (scanned / total).
    expect(await screen.findByText(/400 \/ 1,000/)).toBeInTheDocument()

    // Eventually reaches the terminal completed state (after one 3s poll cycle).
    expect(
      await screen.findByText(/Backfill complete/i, undefined, {
        timeout: 5000,
      })
    ).toBeInTheDocument()
  })

  it("passes dryRun + batchSize through to the enqueue mutation", async () => {
    mockBoard.mockResolvedValue(BOARD)
    mockEnqueue.mockResolvedValue({
      runId: "11111111-1111-4111-8111-111111111111",
    })
    mockRunStatus.mockResolvedValue(
      backfillRun({ status: "completed", scannedUsers: 1000 })
    )
    const user = userEvent.setup()
    renderPage()

    // Toggle dry-run + set a batch size, then enqueue.
    await user.click(await screen.findByLabelText(/Dry run/i))
    const batch = screen.getByLabelText(/Batch size/i)
    await user.clear(batch)
    await user.type(batch, "250")
    await user.click(
      screen.getByRole("button", { name: /Backfill wallet networks/i })
    )

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith({ dryRun: true, batchSize: 250 })
    })
  })

  it("shows the backfill error branch when the run fails", async () => {
    mockBoard.mockResolvedValue(BOARD)
    mockEnqueue.mockResolvedValue({
      runId: "11111111-1111-4111-8111-111111111111",
    })
    mockRunStatus.mockResolvedValue(
      backfillRun({
        status: "failed",
        scannedUsers: 120,
        failures: [{ userId: "u1", error: "provider timeout" }],
      })
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: /Backfill wallet networks/i })
    )

    expect(await screen.findByText(/Backfill failed/i)).toBeInTheDocument()
    // The failure count surfaces so the operator can audit the run.
    expect(await screen.findByText(/1 failure/i)).toBeInTheDocument()
  })
})
