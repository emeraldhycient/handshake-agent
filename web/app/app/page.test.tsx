import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AppPage from "./page"

// RequireAuth uses useRouter — mock next/navigation so tests don't error.
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

// RequireVerified uses useMe → fetchMe. Return a verified user so the guard
// passes through immediately rather than redirecting or showing the loading state.
vi.mock("@/lib/api/auth", () => ({
  fetchMe: vi.fn().mockResolvedValue({
    userId: "11111111-1111-1111-1111-111111111111",
    email: "user@example.com",
    kycStatus: "verified",
    kycTier: "1",
    hasPin: true,
  }),
  submitSignup: vi.fn(),
  submitVerifyEmail: vi.fn(),
  submitLoginRequest: vi.fn(),
  submitLoginVerify: vi.fn(),
  refreshSession: vi.fn(),
  logout: vi.fn(),
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

// Pre-seeded verified user for TanStack Query cache — avoids the async
// "Loading…" state in RequireVerified during synchronous render assertions.
const VERIFIED_ME = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "user@example.com",
  kycStatus: "verified",
  kycTier: "1",
  hasPin: true,
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Seed the /me query so RequireVerified passes through synchronously.
  client.setQueryData(["auth", "me"], VERIFIED_ME)
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
