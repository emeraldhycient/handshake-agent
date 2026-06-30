/**
 * Tests for the `/` root route (adaptive entry point).
 *
 * The default jsdom matchMedia stub (vitest.setup.ts) returns matches:false,
 * so the mobile surface is selected after effects flush.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, afterEach, vi } from "vitest"
import Home from "./page"

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
  // Sidebar verified-badge reads the real tier via useProfile → fetchProfile.
  fetchProfile: vi.fn().mockResolvedValue({
    email: "user@example.com",
    fullName: "Ada Tester",
    phone: null,
    kycStatus: "verified",
    kycTier: "tier_1",
    fiatCurrency: "NGN",
    limits: null,
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
// "Loading…" state in RequireVerified during render assertions.
const VERIFIED_ME = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "user@example.com",
  kycStatus: "verified",
  kycTier: "1",
  hasPin: true,
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Seed the /me query so RequireVerified passes through synchronously.
  client.setQueryData(["auth", "me"], VERIFIED_ME)
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

describe("/ root route (adaptive entry)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the mobile chat app when matchMedia reports a non-desktop viewport", async () => {
    // Default stub: matches:false → mobile surface
    render(<Home />, { wrapper: makeWrapper() })

    // MobileShell renders the greeting message in the thread after effects
    await waitFor(() => {
      expect(screen.getByText(/I'm your Handshake Agent/i)).toBeInTheDocument()
    })
  })

  it("does not render 'Open mobile app' or 'Open desktop dashboard' manual choice links", async () => {
    render(<Home />, { wrapper: makeWrapper() })

    // Wait for effect to fire (moves out of splash state)
    await waitFor(() => {
      expect(screen.queryByText(/open mobile app/i)).toBeNull()
    })

    expect(screen.queryByText(/open desktop dashboard/i)).toBeNull()
  })

  it("renders the desktop dashboard when matchMedia reports a desktop viewport", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(min-width: 1024px)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList)

    render(<Home />, { wrapper: makeWrapper() })

    // DashboardExperience renders the desktop chat rail greeting
    await waitFor(() => {
      expect(screen.getByText(/Welcome back, Amara/i)).toBeInTheDocument()
    })
  })
})
