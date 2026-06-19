import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DashboardTopbar } from "./dashboard-topbar"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

describe("DashboardTopbar", () => {
  it("renders the greeting", () => {
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    expect(screen.getByText(/good afternoon, amara/i)).toBeInTheDocument()
  })

  it("typing in search filters to a matching result", async () => {
    const user = userEvent.setup()
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    const input = screen.getByPlaceholderText(/search or ask handshake/i)
    await user.click(input)
    await user.type(input, "wallet")
    // Wait for the search results to appear
    await waitFor(() => expect(screen.getByText(/wallet/i)).toBeInTheDocument())
  })

  it("selecting a search result fires onSearchSelect", async () => {
    const onSearchSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <DashboardTopbar
        onSearchSelect={onSearchSelect}
        onQuickAction={() => {}}
      />,
      { wrapper: makeWrapper() }
    )
    const input = screen.getByPlaceholderText(/search or ask handshake/i)
    await user.click(input)
    await user.type(input, "wallet")
    // Wait for dropdown to render and click the first result
    const walletResult = await screen.findByText(/wallet/i)
    await user.click(walletResult)
    expect(onSearchSelect).toHaveBeenCalledOnce()
  })

  it("bell shows unread count badge", async () => {
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    // Wait for notifications to load; then check the badge
    const bell = screen.getByRole("button", { name: /notifications/i })
    expect(bell).toBeInTheDocument()
    // Badge appears once data loads
    await waitFor(() => {
      const badges = screen.queryAllByText(/^\d+$/)
      expect(badges.length).toBeGreaterThan(0)
    })
  })

  it("clicking bell opens the notifications dropdown", async () => {
    const user = userEvent.setup()
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    const bell = screen.getByRole("button", { name: /notifications/i })
    await user.click(bell)
    await waitFor(() =>
      expect(screen.getByText(/notifications/i)).toBeInTheDocument()
    )
  })

  it("Mark all read clears the unread badge", async () => {
    const user = userEvent.setup()
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    // Wait for notifications to load
    await waitFor(() => {
      const badges = screen.queryAllByText(/^\d+$/)
      expect(badges.length).toBeGreaterThan(0)
    })
    // Open dropdown and click "Mark all read"
    const bell = screen.getByRole("button", { name: /notifications/i })
    await user.click(bell)
    await user.click(screen.getByRole("button", { name: /mark all read/i }))
    // Badge should be gone
    await waitFor(() => {
      const badges = screen.queryAllByText(/^\d+$/)
      expect(badges.length).toBe(0)
    })
  })
})
