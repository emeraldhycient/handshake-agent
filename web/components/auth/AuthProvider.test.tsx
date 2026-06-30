/**
 * TDD tests for AuthProvider hydration fix.
 *
 * The previous implementation called useState(needsRehydration) which read
 * localStorage at state-initialisation time. On the server localStorage is
 * unavailable (returns null) but on the client it might return a persisted
 * refreshToken — causing a server/client tree mismatch ("Hydration failed").
 *
 * The fix: remove the rehydrating state entirely (it was a debug artifact
 * not consumed by any other component). All localStorage-dependent logic runs
 * inside useEffect (client-only, post-hydration), so the component renders a
 * stable tree on both server and client.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/api/auth", () => ({
  refreshSession: vi.fn(),
  fetchMe: vi.fn(),
}))

// defaultAuthStore.getState() is called inside the useEffect.
// Expose a mutable object so tests can simulate different localStorage states.
const mockStoreState = {
  refreshToken: null as string | null,
  accessToken: null as string | null,
  setTokens: vi.fn(),
  setUser: vi.fn(),
  clear: vi.fn(),
}

vi.mock("@/lib/store/auth-store", () => ({
  defaultAuthStore: {
    getState: vi.fn(() => mockStoreState),
  },
  useAuthStore: vi.fn(() => ({
    accessToken: mockStoreState.accessToken,
    refreshToken: mockStoreState.refreshToken,
  })),
}))

// Import AFTER vi.mock declarations so mocks are active
import { AuthProvider } from "./AuthProvider"
import { refreshSession, fetchMe } from "@/lib/api/auth"

const mockRefreshSession = vi.mocked(refreshSession)
const mockFetchMe = vi.mocked(fetchMe)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.refreshToken = null
    mockStoreState.accessToken = null
  })

  it("renders children immediately", () => {
    render(
      <AuthProvider>
        <span>child content</span>
      </AuthProvider>
    )
    expect(screen.getByText("child content")).toBeInTheDocument()
  })

  it("does not add a data-auth-rehydrating attribute (hydration mismatch source)", () => {
    // The data-auth-rehydrating attribute was removed because its value differed
    // between server (always false, no localStorage) and client (could be true).
    // This test guards against re-introducing it without suppressHydrationWarning.
    const { container } = render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )
    expect(container.querySelector("[data-auth-rehydrating]")).toBeNull()
  })

  it("does not call refreshSession when no refreshToken in store", () => {
    mockStoreState.refreshToken = null
    mockStoreState.accessToken = null

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    expect(mockRefreshSession).not.toHaveBeenCalled()
  })

  it("does not call refreshSession when accessToken is already present", () => {
    mockStoreState.refreshToken = "valid-refresh-token"
    mockStoreState.accessToken = "valid-access-token"

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    expect(mockRefreshSession).not.toHaveBeenCalled()
  })

  it("calls refreshSession on mount when refreshToken present but no accessToken", async () => {
    mockStoreState.refreshToken = "valid-refresh-token"
    mockStoreState.accessToken = null
    mockRefreshSession.mockResolvedValueOnce({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    })
    mockFetchMe.mockResolvedValueOnce({
      userId: "u1",
      email: "a@b.com",
      kycStatus: "none",
      kycTier: "0",
      hasPin: false,
    })

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    // refreshSession is called asynchronously in a useEffect
    await waitFor(() => {
      expect(mockRefreshSession).toHaveBeenCalledWith("valid-refresh-token")
    })
  })

  it("calls clear() when refreshSession rejects", async () => {
    mockStoreState.refreshToken = "expired-refresh-token"
    mockStoreState.accessToken = null
    mockRefreshSession.mockRejectedValueOnce(new Error("Token expired"))

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    await waitFor(() => {
      expect(mockStoreState.clear).toHaveBeenCalled()
    })
  })
})
