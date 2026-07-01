import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, afterEach } from "vitest"
import { ActivityPage } from "./activity-page"
import * as chatApi from "@/lib/api/chat"
import * as gatewayModule from "@/lib/api/gateway"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("ActivityPage", () => {
  afterEach(() => vi.restoreAllMocks())

  it("shows loading skeletons initially", () => {
    render(<ActivityPage />, { wrapper })
    const skeletons = document.querySelectorAll("[data-slot='skeleton']")
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("renders the page headline", async () => {
    render(<ActivityPage />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Activity/i)).toBeInTheDocument()
    })
  })

  it("renders filter buttons", async () => {
    render(<ActivityPage />, { wrapper })
    await waitFor(() => {
      // Exact name avoids matching row aria-labels that contain these words
      expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: "Received" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sent" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Tickets" })).toBeInTheDocument()
  })

  it("renders activity groups with items", async () => {
    render(<ActivityPage />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Bought USDT/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Today/i)).toBeInTheDocument()
  })

  it("filters to only incoming items when 'Received' is clicked", async () => {
    const user = userEvent.setup()
    render(<ActivityPage />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Bought USDT/i)).toBeInTheDocument()
    })
    // Both bought and sent are visible by default
    expect(screen.getByText(/Sent USDT/i)).toBeInTheDocument()

    // Click Received filter — exact name avoids matching row aria-labels
    await user.click(screen.getByRole("button", { name: "Received" }))

    // Sent row should be hidden
    expect(screen.queryByText(/Sent USDT/i)).not.toBeInTheDocument()
    // Bought row (dir: "in") should still show
    expect(screen.getByText(/Bought USDT/i)).toBeInTheDocument()
  })

  it("renders StatusPill for each item", async () => {
    render(<ActivityPage />, { wrapper })
    await waitFor(() => {
      const pills = screen.getAllByText(/Completed/i)
      expect(pills.length).toBeGreaterThan(0)
    })
  })

  it("paginates: 'Load more' appends the next page and then disappears", async () => {
    vi.spyOn(gatewayModule.gateway, "getActivityPage")
      .mockResolvedValueOnce({
        items: [
          {
            id: "pg1",
            type: "buy",
            status: "completed",
            asset: "USDT",
            cryptoAmount: "1",
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: "CURSOR1",
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "pg2",
            type: "send",
            status: "completed",
            asset: "USDT",
            cryptoAmount: "2",
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      })
    const user = userEvent.setup()
    render(<ActivityPage />, { wrapper })

    const loadMore = await screen.findByRole("button", { name: /load more/i })
    await user.click(loadMore)

    await waitFor(() =>
      expect(screen.getByText(/Sent USDT/i)).toBeInTheDocument()
    )
    expect(
      screen.queryByRole("button", { name: /load more/i })
    ).not.toBeInTheDocument()
  })

  // ── Finding #5: shared error / empty states ───────────────────────────────
  it("renders the shared QueryErrorState with a Retry button on failure", async () => {
    vi.spyOn(gatewayModule.gateway, "getActivityPage").mockRejectedValue(
      new Error("Network error")
    )
    render(<ActivityPage />, { wrapper })
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
  })

  it("renders the shared QueryEmptyState when there is no activity", async () => {
    vi.spyOn(gatewayModule.gateway, "getActivityPage").mockResolvedValue({
      items: [],
      nextCursor: null,
    })
    render(<ActivityPage />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/no activity yet/i)).toBeInTheDocument()
    })
  })

  it("clicking a row opens the TransactionDetailModal", async () => {
    // Make detail fetch hang so we can observe the modal loading state
    vi.spyOn(chatApi, "getTransactionDetail").mockReturnValue(
      new Promise(() => {})
    )
    const user = userEvent.setup()
    render(<ActivityPage />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Bought USDT/i)).toBeInTheDocument()
    })

    // Find the row button by its exact aria-label
    const row = screen.getByRole("button", {
      name: "View details for Bought USDT",
    })
    await user.click(row)

    // Dialog should appear with the generic loading title (data is still loading)
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })
    expect(screen.getByText("Transaction Detail")).toBeInTheDocument()
  })
})
