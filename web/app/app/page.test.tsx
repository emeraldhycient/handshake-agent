import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AppPage from "./page"

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

describe("/app page", () => {
  it("renders MobileShell with the chat header", () => {
    render(<AppPage />, { wrapper })
    expect(screen.getByText("Handshake Agent")).toBeInTheDocument()
  })

  it("renders the bottom navigation", () => {
    render(<AppPage />, { wrapper })
    expect(
      screen.getByRole("navigation", { name: /main navigation/i })
    ).toBeInTheDocument()
  })
})
