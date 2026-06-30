import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, afterEach } from "vitest"
import { OverviewPage } from "./overview-page"
import * as gatewayModule from "@/lib/api/gateway"

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

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
      expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: "Buy" }))
    expect(onQuickAction).toHaveBeenCalledWith("buy", expect.any(String))
  })

  // ── Finding #7: no permanently-empty Price / 24h columns ──────────────────
  it("does not render the always-empty Price column header", async () => {
    render(<OverviewPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Tether USD/i)).toBeInTheDocument()
    })
    // The asset table must not advertise a "Price" or "24h" column it can never fill.
    expect(screen.queryByText("Price")).not.toBeInTheDocument()
    expect(screen.queryByText("24h")).not.toBeInTheDocument()
  })

  it("keeps the real Asset / Holdings / Value columns", async () => {
    render(<OverviewPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Tether USD/i)).toBeInTheDocument()
    })
    expect(screen.getByText("Holdings")).toBeInTheDocument()
    expect(screen.getByText("Value")).toBeInTheDocument()
  })

  // ── Finding #5: shared error state with a retry affordance ─────────────────
  it("renders the shared QueryErrorState with a Retry button on failure", async () => {
    vi.spyOn(gatewayModule.gateway, "getBalances").mockRejectedValue(
      new Error("Network error")
    )
    vi.spyOn(gatewayModule.gateway, "getWalletAssets").mockRejectedValue(
      new Error("Network error")
    )
    vi.spyOn(gatewayModule.gateway, "getActivityPage").mockRejectedValue(
      new Error("Network error")
    )

    render(<OverviewPage onQuickAction={() => {}} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
  })
})
