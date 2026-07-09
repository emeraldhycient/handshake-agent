/**
 * AuthProvider — boot rehydration (Wave H: HttpOnly refresh cookie).
 *
 * On mount, with no access token in memory, the provider calls POST /auth/refresh
 * (no body — the HttpOnly `ha_refresh` cookie carries the token) exactly once and:
 *   - 200 → setSession(accessToken + user)  → authenticated
 *   - 401 → clear()                         → anonymous (logged out)
 *   - error (network/500) → clear()         → anonymous (never stuck loading)
 * If an access token is already in memory (fresh login), it does nothing.
 *
 * The provider renders children immediately; RequireAuth drives the loading /
 * redirect UI off the store status.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/api/auth", () => ({
  refreshSession: vi.fn(),
}))

// defaultAuthStore.getState() is called inside the effect. Expose a mutable
// object so tests can simulate the in-memory access-token state.
const mockStoreState = {
  accessToken: null as string | null,
  setSession: vi.fn(),
  setUser: vi.fn(),
  clear: vi.fn(),
}

vi.mock("@/lib/store/auth-store", () => ({
  defaultAuthStore: {
    getState: vi.fn(() => mockStoreState),
  },
  useAuthStore: vi.fn(() => ({ accessToken: mockStoreState.accessToken })),
}))

// Import AFTER vi.mock declarations so mocks are active.
import { AuthProvider } from "./AuthProvider"
import { refreshSession } from "@/lib/api/auth"

const mockRefreshSession = vi.mocked(refreshSession)

const bootUser = {
  userId: "u1",
  email: "a@b.com",
  kycStatus: "verified" as const,
  kycTier: "1",
  hasPin: true,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AuthProvider — boot rehydration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.accessToken = null
    // Default: a benign resolved refresh so the mount effect never calls `.then`
    // on `undefined`. Individual tests override with mock*ValueOnce.
    mockRefreshSession.mockReset()
    mockRefreshSession.mockResolvedValue({
      accessToken: "boot-access",
      refreshToken: "rotated",
      user: bootUser,
    })
  })

  it("renders children immediately (does not block on the refresh)", () => {
    render(
      <AuthProvider>
        <span>child content</span>
      </AuthProvider>
    )
    expect(screen.getByText("child content")).toBeInTheDocument()
  })

  it("does not add a data-auth-rehydrating attribute (hydration-mismatch source)", () => {
    const { container } = render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )
    expect(container.querySelector("[data-auth-rehydrating]")).toBeNull()
  })

  it("attempts a cookie refresh (no args) on mount when no access token is held", async () => {
    mockStoreState.accessToken = null
    mockRefreshSession.mockResolvedValueOnce({
      accessToken: "new-access",
      refreshToken: "rotated",
      user: bootUser,
    })

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    await waitFor(() => {
      expect(mockRefreshSession).toHaveBeenCalledTimes(1)
    })
    // Called with no arguments — the cookie carries the refresh token.
    expect(mockRefreshSession.mock.calls[0]).toHaveLength(0)
  })

  it("authenticated: on a 200 refresh, sets the session from accessToken + user", async () => {
    mockStoreState.accessToken = null
    mockRefreshSession.mockResolvedValueOnce({
      accessToken: "new-access",
      refreshToken: "rotated",
      user: bootUser,
    })

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    await waitFor(() => {
      expect(mockStoreState.setSession).toHaveBeenCalledWith({
        accessToken: "new-access",
        user: bootUser,
      })
    })
    expect(mockStoreState.clear).not.toHaveBeenCalled()
  })

  it("unauthenticated: clears the session when the refresh rejects (401)", async () => {
    mockStoreState.accessToken = null
    mockRefreshSession.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { status: 401 })
    )

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    await waitFor(() => {
      expect(mockStoreState.clear).toHaveBeenCalled()
    })
    expect(mockStoreState.setSession).not.toHaveBeenCalled()
  })

  it("error: a network/500 failure also resolves to anonymous (never stuck loading)", async () => {
    mockStoreState.accessToken = null
    mockRefreshSession.mockRejectedValueOnce(new Error("Network Error"))

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    await waitFor(() => {
      expect(mockStoreState.clear).toHaveBeenCalled()
    })
  })

  it("does not refresh when an access token is already in memory (fresh login)", () => {
    mockStoreState.accessToken = "already-authenticated"

    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>
    )

    expect(mockRefreshSession).not.toHaveBeenCalled()
  })
})
