import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { OverviewPage } from "./overview-page"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("OverviewPage", () => {
  it("shows loading skeletons initially", () => {
    render(<OverviewPage onQuickAction={() => {}} />, { wrapper })
    // Skeletons render before data resolves
    const skeletons = document.querySelectorAll("[data-slot='skeleton']")
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("renders the balance hero and asset table after data loads", async () => {
    render(<OverviewPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Total balance/i)).toBeInTheDocument()
    })
    // Asset table columns
    expect(screen.getByText(/Asset/i)).toBeInTheDocument()
    // Tether USD row
    expect(screen.getByText(/Tether USD/i)).toBeInTheDocument()
  })

  it("renders recent activity section", async () => {
    render(<OverviewPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Recent activity/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Bought USDT/i)).toBeInTheDocument()
  })

  it("fires onQuickAction when a hero action button is clicked", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<OverviewPage onQuickAction={onQuickAction} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Buy/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: /Buy/i }))
    expect(onQuickAction).toHaveBeenCalledWith("buy", expect.any(String))
  })
})
