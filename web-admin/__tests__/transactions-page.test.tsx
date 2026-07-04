/**
 * TransactionsPage (real-data wiring) tests.
 *
 * TransactionsPage now reads from the engine via `useTransactions` → the mocked
 * `@/lib/api/transactions` client; the list's rows, view-tab status filter and the
 * cursor pager come from `AdminTxnListResponse`. These tests assert the loading→data
 * branch, the empty branch, the error branch, and that a view tab re-queries with the
 * mapped status filter. TransactionDetail is now read-wired too, covered by its own
 * `transaction-detail.test.tsx`.
 *
 * The list uses `useRouter().push` on row click, so `next/navigation` is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminTxnListResponse } from "@handshake-agent/contracts"

import { TransactionsPage } from "@/components/admin/transactions-page"
import { defaultToastStore } from "@/lib/store/toast-store"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("@/lib/api/transactions", () => ({
  listTransactions: vi.fn(),
}))

import { listTransactions } from "@/lib/api/transactions"

const mockList = vi.mocked(listTransactions)

const UUID_A = "11111111-1111-1111-1111-111111111111"
const UUID_B = "22222222-2222-2222-2222-222222222222"

const RESPONSE: AdminTxnListResponse = {
  items: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      userId: UUID_A,
      userEmail: "amara.okeke@example.com",
      type: "buy",
      status: "settling",
      asset: "USDT",
      amount: "10.5",
      fiatAmount: "16500.00",
      fiatCurrency: "NGN",
      idempotencyKey: "idem_buy_abc",
      createdAt: "2026-07-01T09:42:00.000Z",
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      userId: UUID_B,
      userEmail: null,
      type: "send",
      status: "completed",
      asset: null,
      amount: null,
      fiatAmount: null,
      fiatCurrency: null,
      idempotencyKey: "idem_send_def",
      createdAt: "2026-07-01T10:15:00.000Z",
    },
  ],
  nextCursor: null,
  counts: { all: 7, stuck: 2, failed: 1, refunds: 0 },
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
  push.mockClear()
  mockList.mockReset()
  mockList.mockResolvedValue(RESPONSE)
  defaultToastStore.setState({ toasts: [] })
})

describe("TransactionsPage (real-data wiring)", () => {
  it("shows a loading state, then renders the real rows and columns", async () => {
    // Hold the request open so the loading (aria-busy) branch is observable.
    let resolve!: (v: AdminTxnListResponse) => void
    mockList.mockReturnValueOnce(
      new Promise<AdminTxnListResponse>((r) => {
        resolve = r
      })
    )

    renderPage()

    // The 7-column ledger table headers are always present.
    expect(screen.getByText("ID")).toBeInTheDocument()
    expect(screen.getByText("Idempotency key")).toBeInTheDocument()
    // Loading branch.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()

    resolve(RESPONSE)

    // Data branch — a real row id + its mapped status label render.
    expect(
      await screen.findByText("33333333-3333-3333-3333-333333333333")
    ).toBeInTheDocument()
    // The engine "settling" status folds onto the "Settling" pill.
    expect(screen.getByText("Settling")).toBeInTheDocument()
    // "completed" → "Settled".
    expect(screen.getByText("Settled")).toBeInTheDocument()
  })

  it("re-queries with the mapped status filter when a view tab is chosen", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("33333333-3333-3333-3333-333333333333")
    expect(mockList.mock.calls[0][0].status).toBeUndefined()

    await user.click(screen.getByRole("button", { name: /Failed today/ }))

    // "Failed today" maps to status=failed with a from=start-of-day bound.
    await waitFor(() => {
      const last = mockList.mock.calls[mockList.mock.calls.length - 1][0]
      expect(last.status).toBe("failed")
      expect(last.from).toBeTruthy()
    })
  })

  it("renders the enriched amount, derived user name and copyable idem key", async () => {
    renderPage()

    // Amount cell: crypto leg + fiat leg from the enriched contract.
    expect(await screen.findByText("10.5 USDT")).toBeInTheDocument()
    expect(screen.getByText("₦16,500.00")).toBeInTheDocument()
    // User display name derived from the joined email local-part.
    expect(screen.getByText("Amara Okeke")).toBeInTheDocument()
    // Idempotency key rendered (copy affordance) for the buy row.
    expect(screen.getByText("idem_buy_abc")).toBeInTheDocument()
  })

  it("renders the four view-tab count pills from the response counts", async () => {
    renderPage()

    await screen.findByText("10.5 USDT")
    // The "All" pill shows counts.all=7, "Stuck / Pending"=2, "Failed today"=1.
    expect(screen.getByText("7")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("wires the search pill to the backend q param (debounced)", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("10.5 USDT")
    await user.type(
      screen.getByLabelText("Search transactions by id, hash or ref"),
      "flw-ref"
    )

    await waitFor(() => {
      const last = mockList.mock.calls[mockList.mock.calls.length - 1][0]
      expect(last.q).toBe("flw-ref")
    })
  })

  it("renders the design-consistent empty state when there are no rows", async () => {
    mockList.mockResolvedValue({
      items: [],
      nextCursor: null,
      counts: { all: 0, stuck: 0, failed: 0, refunds: 0 },
    })
    renderPage()

    expect(
      await screen.findByText("No transactions match this view.")
    ).toBeInTheDocument()
  })

  it("renders a tokened error with a retry affordance on failure", async () => {
    mockList.mockRejectedValue(new Error("boom"))
    renderPage()

    expect(
      await screen.findByText("Couldn't load transactions")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
