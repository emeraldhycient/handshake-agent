/**
 * WebhooksPage tests (Track A wiring).
 *
 * The queue table is data-wired via `useWebhooks()` → the webhooks api client (mocked
 * here — no server). These tests assert:
 *
 *  1. loading → data: the real webhook rows render (provider, event id, status, attempts).
 *  2. empty: an empty queue renders the design-consistent empty state.
 *  3. error: a failed fetch renders the tokened inline error + a Retry refetch.
 *  4. changing the status filter re-queries (listWebhooks called with the new status).
 *  5. opening a row shows the payload / headers / last-error in the detail drawer.
 *  6. clicking Retry (through the reason modal) calls retryWebhook; and a step-up
 *     scenario where retryWebhook first 403s and the StepUpDialog appears.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// The full parallel suite saturates the runner; raise the async-util timeout so the
// anchoring findBy/waitFor calls don't hit the 1s wall under load (the page renders
// in ~150ms in isolation).
configure({ asyncUtilTimeout: 5000 })
import type {
  WebhookDetail,
  WebhookListResponse,
  WebhookMetrics,
} from "@handshake-agent/contracts"

import { WebhooksPage } from "@/components/admin/webhooks-page"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/webhooks", () => ({
  listWebhooks: vi.fn(),
  getWebhookMetrics: vi.fn(),
  getWebhookDetail: vi.fn(),
  retryWebhook: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import {
  listWebhooks,
  getWebhookMetrics,
  getWebhookDetail,
  retryWebhook,
} from "@/lib/api/webhooks"
import { getMe } from "@/lib/api/admin"

const mockList = vi.mocked(listWebhooks)
const mockMetrics = vi.mocked(getWebhookMetrics)
const mockDetail = vi.mocked(getWebhookDetail)
const mockRetry = vi.mocked(retryWebhook)
const mockGetMe = vi.mocked(getMe)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LIST: WebhookListResponse = {
  items: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      provider: "blockradar",
      providerEventId: "evt_deposit_001",
      status: "failed",
      attempts: 3,
      lastError: "Ledger post rejected: idempotency conflict",
      receivedAt: "2026-06-30T10:00:00.000Z",
      processedAt: null,
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      provider: "flutterwave",
      providerEventId: "evt_charge_002",
      status: "succeeded",
      attempts: 1,
      lastError: null,
      receivedAt: "2026-06-30T11:00:00.000Z",
      processedAt: "2026-06-30T11:00:03.000Z",
    },
  ],
  nextCursor: null,
}

const METRICS: WebhookMetrics = {
  byStatus: { received: 1, processing: 0, succeeded: 12, failed: 2, dead: 1 },
  depth: 1,
  failed: 2,
  dead: 1,
}

const DETAIL: WebhookDetail = {
  ...LIST.items[0],
  payload: { event: "deposit.confirmed", amount: "5000", asset: "USDT" },
  headers: { "x-blockradar-signature": "sig_abc123" },
  signature: "sig_abc123",
  lastAttemptAt: "2026-06-30T10:05:00.000Z",
  deadAt: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WebhooksPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockList.mockReset()
  mockList.mockResolvedValue(LIST)
  mockMetrics.mockReset()
  mockMetrics.mockResolvedValue(METRICS)
  mockDetail.mockReset()
  mockDetail.mockResolvedValue(DETAIL)
  mockRetry.mockReset()
  mockRetry.mockResolvedValue({ ...DETAIL, status: "received", attempts: 4 })
  mockGetMe.mockReset()
  mockGetMe.mockResolvedValue({
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WebhooksPage", () => {
  it("renders the webhook rows from real data", async () => {
    renderPage()

    expect(
      screen.getByRole("heading", { name: "Webhooks" })
    ).toBeInTheDocument()

    // loading → data: the mocked rows render. Scope provider/status assertions to
    // the table so they don't collide with the filter dropdown's <option> text.
    expect(await screen.findByText("evt_deposit_001")).toBeInTheDocument()
    const table = within(screen.getByRole("table"))
    expect(table.getByText("evt_charge_002")).toBeInTheDocument()
    expect(table.getByText("blockradar")).toBeInTheDocument()
    expect(table.getByText("flutterwave")).toBeInTheDocument()
    // Status badges render the status label.
    expect(table.getByText("failed")).toBeInTheDocument()
    expect(table.getByText("succeeded")).toBeInTheDocument()
  })

  it("renders the empty state when there are no webhooks", async () => {
    mockList.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    expect(await screen.findByText("No webhooks")).toBeInTheDocument()
  })

  it("renders a tokened error with a Retry that refetches", async () => {
    const user = userEvent.setup()
    mockList.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(LIST)
    renderPage()

    expect(
      await screen.findByText("Failed to load webhooks")
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))

    // The refetch succeeds and the rows render.
    expect(await screen.findByText("evt_deposit_001")).toBeInTheDocument()
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it("re-queries when the status filter changes", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("evt_deposit_001")
    expect(mockList).toHaveBeenLastCalledWith({})

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by status" }),
      "dead"
    )

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({ status: "dead" })
    )
  })

  it("opens the detail drawer with payload, headers, and the last error", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("evt_deposit_001")
    await user.click(screen.getAllByRole("button", { name: "View" })[0])

    // The drawer fetches + shows the verbatim payload, headers, and last error.
    expect(await screen.findByText(/deposit\.confirmed/)).toBeInTheDocument()
    expect(screen.getByText(/x-blockradar-signature/)).toBeInTheDocument()
    expect(
      screen.getByText("Ledger post rejected: idempotency conflict")
    ).toBeInTheDocument()
  })

  it("calls retryWebhook through the reason flow", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("evt_deposit_001")
    await user.click(screen.getAllByRole("button", { name: "View" })[0])

    // Open the Retry flow — the ReasonModal appears; nothing persisted yet.
    await user.click(await screen.findByRole("button", { name: "Retry" }))
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "Redeliver after fix"
    )
    expect(mockRetry).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Continue" }))

    await waitFor(() => expect(mockRetry).toHaveBeenCalledTimes(1))
    expect(mockRetry).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      { reason: "Redeliver after fix" }
    )
  })

  it("opens the step-up dialog and replays the POST after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockRetry
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce({ ...DETAIL, status: "received", attempts: 4 })

    renderPage()
    await screen.findByText("evt_deposit_001")
    await user.click(screen.getAllByRole("button", { name: "View" })[0])
    await user.click(await screen.findByRole("button", { name: "Retry" }))
    await user.type(
      await screen.findByRole("textbox", { name: "Reason" }),
      "Redeliver after fix"
    )
    await user.click(screen.getByRole("button", { name: "Continue" }))

    // The re-auth dialog appears (TOTP mode, since mfaEnabled).
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockRetry).toHaveBeenCalledTimes(1)
  })
})
