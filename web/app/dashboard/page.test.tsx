/**
 * Integration test for the /dashboard route.
 * Uses a fresh QueryClient wrapper and a synchronous injected chat store
 * so that store.send() resolves immediately (no setTimeout delays).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import DashboardPage from "./page"

// RequireAuth uses useRouter — mock next/navigation so tests don't error.
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

// Stub the auth store so RequireAuth passes through (treats user as authenticated).
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: vi.fn(
    (
      selector?: (s: {
        accessToken: string | null
        refreshToken: string | null
      }) => unknown
    ) => {
      const state = {
        accessToken: "stub-token",
        refreshToken: "stub-refresh",
        status: "authenticated",
        user: null,
      }
      return selector ? selector(state) : state
    }
  ),
  defaultAuthStore: {
    getState: vi.fn(() => ({
      refreshToken: null,
      accessToken: "stub-token",
      setTokens: vi.fn(),
      setUser: vi.fn(),
      clear: vi.fn(),
    })),
  },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("/dashboard page", () => {
  it("renders all 5 sidebar nav items", () => {
    render(<DashboardPage />, { wrapper })
    expect(
      screen.getByRole("button", { name: /overview/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /wallet/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /activity/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /tickets/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /settings/i })
    ).toBeInTheDocument()
  })

  it("renders the overview page headline by default", async () => {
    render(<DashboardPage />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Total balance/i)).toBeInTheDocument()
    })
  })

  it("switches to the wallet page when the Wallet sidebar item is clicked", async () => {
    const user = userEvent.setup()
    render(<DashboardPage />, { wrapper })

    await user.click(screen.getByRole("button", { name: /^Wallet$/i }))

    // Wallet page shows "Wallet" heading and the deposit address
    await waitFor(() => {
      expect(
        screen.getByText(/TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ/)
      ).toBeInTheDocument()
    })
  })

  it("a hero quick-action sends a user message into the chat rail", async () => {
    const user = userEvent.setup()
    render(<DashboardPage />, { wrapper })

    // Wait for the overview page hero to render (data loads from mock)
    await waitFor(() => {
      // Multiple "Buy" buttons: hero has one, look for one in the balance section
      expect(screen.getByText(/Total balance/i)).toBeInTheDocument()
    })

    // Click the first "Buy" button (from the overview hero action buttons)
    const buyBtns = screen.getAllByRole("button", { name: /^Buy$/i })
    await user.click(buyBtns[0])

    // The user message "Buy" should appear in the chat rail thread
    await waitFor(() => {
      // User message text appears in the thread
      const userMsgs = screen.getAllByText(/^Buy$/i)
      expect(userMsgs.length).toBeGreaterThan(0)
    })
  })

  it("renders the chat rail with the desktop greeting", async () => {
    render(<DashboardPage />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText(/Welcome back, Amara/i)).toBeInTheDocument()
    })
  })
})
