/**
 * TransactionsPage + TransactionDetail tests.
 *
 *  1. The transactions table renders a row per transaction; selecting a status
 *     filter re-queries with that status.
 *  2. A mark-failed action that 403s with ADMIN_STEP_UP_REQUIRED opens the
 *     step-up dialog (the `useStepUpRetry` flow).
 *
 * The api layer is mocked — no server.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AdminMe,
  AdminTxnDetail,
  AdminTxnListResponse,
} from "@handshake-agent/contracts"

import { TransactionsPage } from "@/components/admin/transactions-page"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

vi.mock("@/lib/api/transactions", () => ({
  listTransactions: vi.fn(),
  getTransaction: vi.fn(),
  markTransactionFailed: vi.fn(),
  retryTransaction: vi.fn(),
}))

import { getMe } from "@/lib/api/admin"
import {
  listTransactions,
  getTransaction,
  markTransactionFailed,
} from "@/lib/api/transactions"

const mockGetMe = vi.mocked(getMe)
const mockList = vi.mocked(listTransactions)
const mockGet = vi.mocked(getTransaction)
const mockMarkFailed = vi.mocked(markTransactionFailed)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
  status: "active",
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

const LIST: AdminTxnListResponse = {
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      type: "buy",
      status: "settling",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      type: "sell",
      status: "completed",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  nextCursor: null,
}

const DETAIL: AdminTxnDetail = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  type: "buy",
  status: "settling",
  idempotencyKey: "idem-123",
  processorTxRef: null,
  onChainTxHash: null,
  failureReason: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  executedAt: null,
  completedAt: null,
  failedAt: null,
  ledgerLegs: [],
  timeline: [{ status: "pending", at: "2026-01-01T00:00:00.000Z" }],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TransactionsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockGetMe.mockReset()
  mockList.mockReset()
  mockGet.mockReset()
  mockMarkFailed.mockReset()
  mockGetMe.mockResolvedValue(ME)
  mockList.mockResolvedValue(LIST)
  mockGet.mockResolvedValue(DETAIL)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TransactionsPage", () => {
  it("renders a row per transaction and re-queries on a status filter", async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText("buy")).toBeInTheDocument()
    expect(screen.getByText("sell")).toBeInTheDocument()

    // Select a status filter → the query re-fires with that status.
    await user.selectOptions(screen.getByLabelText("Status"), "settling")

    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ status: "settling" })
      )
    )
  })

  it("opens the step-up dialog when mark-failed returns ADMIN_STEP_UP_REQUIRED", async () => {
    mockMarkFailed.mockRejectedValue(
      new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED")
    )

    const user = userEvent.setup()
    renderPage()

    // Open the detail drawer for the settling transaction.
    await user.click(await screen.findByText("buy"))

    // The triage section appears (settling is triageable). Enter a reason + mark.
    const reasonInput = await screen.findByLabelText("Mark-failed reason")
    await user.type(reasonInput, "stuck in settling")
    await user.click(screen.getByRole("button", { name: "Mark failed" }))

    await waitFor(() => expect(mockMarkFailed).toHaveBeenCalled())

    // The step-up dialog surfaces on the 403.
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
  })
})
