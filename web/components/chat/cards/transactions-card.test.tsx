import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TransactionsCard } from "./transactions-card"

// Control the "Show more" fetch without a network round-trip.
const { getPageMock } = vi.hoisted(() => ({ getPageMock: vi.fn() }))
vi.mock("@/lib/api/gateway", () => ({
  gateway: { getTransactionHistoryPage: getPageMock },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const base = {
  kind: "transactions" as const,
  windowLabel: "This month",
  totalCount: 1,
  truncated: false,
  downloadUrl:
    "https://api.example.com/transactions/statement/download?token=tok",
  from: "2026-06-01T00:00:00.000Z",
  to: "2026-06-29T10:00:00.000Z",
  txType: "all",
  hasMore: false,
  nextCursor: null,
  density: "mobile" as const,
}

const row = (id: string, amount: string) => ({
  id,
  type: "buy",
  status: "completed",
  direction: "in" as const,
  amount,
  sub: "2026-06-10",
})

describe("TransactionsCard", () => {
  afterEach(() => vi.clearAllMocks())

  it("renders rows and a download link", () => {
    render(<TransactionsCard {...base} rows={[row("t1", "+29.97 USDT")]} />, {
      wrapper,
    })
    expect(screen.getByText("+29.97 USDT")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /download/i })
    expect(link).toHaveAttribute("href", base.downloadUrl)
  })

  it("renders an empty state", () => {
    render(<TransactionsCard {...base} totalCount={0} rows={[]} />, { wrapper })
    expect(screen.getByText(/no transactions/i)).toBeInTheDocument()
  })

  it("hides Show more when there is no next page", () => {
    render(<TransactionsCard {...base} rows={[row("t1", "+10 USDT")]} />, {
      wrapper,
    })
    expect(
      screen.queryByRole("button", { name: /show more/i })
    ).not.toBeInTheDocument()
  })

  it("shows Show more when hasMore and appends the next page on click", async () => {
    getPageMock.mockResolvedValue({
      rows: [row("t2", "-5 USDT")],
      hasMore: false,
      nextCursor: null,
    })
    const user = userEvent.setup()
    render(
      <TransactionsCard
        {...base}
        totalCount={2}
        hasMore
        nextCursor="CURSOR1"
        rows={[row("t1", "+10 USDT")]}
      />,
      { wrapper }
    )

    const btn = screen.getByRole("button", { name: /show more/i })
    await user.click(btn)

    // The appended row from page 2 is now visible.
    await waitFor(() => expect(screen.getByText("-5 USDT")).toBeInTheDocument())
    // It re-queried the FROZEN window + cursor.
    expect(getPageMock).toHaveBeenCalledWith({
      from: base.from,
      to: base.to,
      txType: "all",
      cursor: "CURSOR1",
    })
    // No further pages → the button is gone.
    expect(
      screen.queryByRole("button", { name: /show more/i })
    ).not.toBeInTheDocument()
  })

  it("surfaces an error when loading the next page fails", async () => {
    getPageMock.mockRejectedValue(new Error("boom"))
    const user = userEvent.setup()
    render(
      <TransactionsCard
        {...base}
        totalCount={2}
        hasMore
        nextCursor="CURSOR1"
        rows={[row("t1", "+10 USDT")]}
      />,
      { wrapper }
    )
    await user.click(screen.getByRole("button", { name: /show more/i }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
  })
})
