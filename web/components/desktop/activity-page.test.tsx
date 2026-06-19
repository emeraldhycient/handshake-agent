import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { ActivityPage } from "./activity-page"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("ActivityPage", () => {
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
      expect(screen.getByRole("button", { name: /All/i })).toBeInTheDocument()
    })
    expect(
      screen.getByRole("button", { name: /Received/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Sent/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Tickets/i })).toBeInTheDocument()
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

    // Click Received filter
    await user.click(screen.getByRole("button", { name: /Received/i }))

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
})
