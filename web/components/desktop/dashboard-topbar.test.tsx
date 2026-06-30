import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DashboardTopbar } from "./dashboard-topbar"
import { gateway } from "@/lib/api/gateway"
import type { MeResponse } from "@handshake-agent/contracts/auth"
import { defaultAuthStore } from "@/lib/store/auth-store"
import type { AppNotification, SearchResult } from "@/lib/schemas"

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
  afterEach(() => vi.restoreAllMocks())

  it("renders a time-of-day greeting without a hardcoded name when no user is loaded", () => {
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    // Matches "Good morning", "Good afternoon", or "Good evening" — no name appended.
    expect(
      screen.getByText(/^good (morning|afternoon|evening)$/i)
    ).toBeInTheDocument()
  })

  it("renders greeting with first name when the auth store has a user with a name", () => {
    const meFixture: MeResponse = {
      userId: "11111111-1111-1111-1111-111111111111",
      email: "amara@example.com",
      kycStatus: "verified",
      kycTier: "tier_1",
      hasPin: true,
      firstName: "Amara",
      lastName: "Okeke",
    }
    // Populate the auth store's user directly — this is how the store is set
    // after login (setSession) and is the source the topbar reads from.
    defaultAuthStore.getState().setUser(meFixture)

    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    expect(
      screen.getByText(/^good (morning|afternoon|evening), amara$/i)
    ).toBeInTheDocument()

    // Clean up store state to avoid polluting other tests.
    defaultAuthStore.getState().clear()
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

  it("search dropdown shows error branch when getSearchCatalog rejects", async () => {
    vi.spyOn(gateway, "getSearchCatalog").mockRejectedValue(
      new Error("network error")
    )
    const user = userEvent.setup()
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    const input = screen.getByPlaceholderText(/search or ask handshake/i)
    await user.click(input)
    await waitFor(() => {
      expect(screen.getByText(/couldn't load results/i)).toBeInTheDocument()
    })
  })

  it("notifications dropdown shows error branch when getNotifications rejects", async () => {
    vi.spyOn(gateway, "getNotifications").mockRejectedValue(
      new Error("network error")
    )
    const user = userEvent.setup()
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    const bell = screen.getByRole("button", { name: /notifications/i })
    await user.click(bell)
    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load notifications/i)
      ).toBeInTheDocument()
    })
  })

  it("search dropdown shows a loading state while getSearchCatalog is pending", async () => {
    // A never-resolving promise keeps the query in its loading state.
    vi.spyOn(gateway, "getSearchCatalog").mockReturnValue(
      new Promise<SearchResult[]>(() => {})
    )
    const user = userEvent.setup()
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    const input = screen.getByPlaceholderText(/search or ask handshake/i)
    await user.click(input)
    expect(await screen.findByText(/searching/i)).toBeInTheDocument()
  })

  it("notifications dropdown shows a loading skeleton while getNotifications is pending", async () => {
    // A never-resolving promise keeps the query in its loading state.
    vi.spyOn(gateway, "getNotifications").mockReturnValue(
      new Promise<AppNotification[]>(() => {})
    )
    const user = userEvent.setup()
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    const bell = screen.getByRole("button", { name: /notifications/i })
    await user.click(bell)
    const loading = await screen.findByTestId("notif-loading")
    // Skeleton placeholders render — not the loaded rows or the empty/error copy.
    expect(
      loading.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/no notifications/i)).not.toBeInTheDocument()
  })

  it("search input has combobox role and aria attributes", () => {
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    const input = screen.getByRole("combobox", { name: /search/i })
    expect(input).toHaveAttribute("aria-haspopup", "listbox")
    expect(input).toHaveAttribute("aria-controls", "dashboard-search-listbox")
    expect(input).toHaveAttribute("aria-expanded", "false")
  })

  it("search dropdown container has listbox role when open", async () => {
    const user = userEvent.setup()
    render(
      <DashboardTopbar onSearchSelect={() => {}} onQuickAction={() => {}} />,
      { wrapper: makeWrapper() }
    )
    const input = screen.getByRole("combobox", { name: /search/i })
    await user.click(input)
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument()
    })
  })
})
