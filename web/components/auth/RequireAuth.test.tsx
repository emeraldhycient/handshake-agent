/**
 * TDD tests for RequireAuth mounted-gate hydration fix.
 *
 * Ensures RequireAuth renders null before mount (matching the server render)
 * and only shows auth-dependent content after mount. This prevents the
 * hydration mismatch caused by Zustand reading localStorage during SSR.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}))

// Auth store mock — we can configure per-test
let mockAccessToken: string | null = null
let mockRefreshToken: string | null = null

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      accessToken: mockAccessToken,
      refreshToken: mockRefreshToken,
    }
    return selector ? selector(state) : state
  }),
  defaultAuthStore: {
    getState: vi.fn(() => ({
      refreshToken: null,
      accessToken: null,
      setTokens: vi.fn(),
      setUser: vi.fn(),
      clear: vi.fn(),
    })),
  },
}))

import { RequireAuth } from "./RequireAuth"

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RequireAuth", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockPush.mockReset()
    mockAccessToken = null
    mockRefreshToken = null
  })

  it("renders children after mount when accessToken is present", async () => {
    mockAccessToken = "valid-access-token"
    mockRefreshToken = "valid-refresh-token"

    render(
      <RequireAuth>
        <span>protected content</span>
      </RequireAuth>
    )

    await waitFor(() => {
      expect(screen.getByText("protected content")).toBeInTheDocument()
    })
  })

  it("shows loading state after mount when refreshToken present but no accessToken", async () => {
    mockAccessToken = null
    mockRefreshToken = "refresh-token"

    render(
      <RequireAuth>
        <span>protected content</span>
      </RequireAuth>
    )

    // After mount, should show loading rather than children
    await waitFor(() => {
      expect(screen.queryByText("protected content")).not.toBeInTheDocument()
    })
  })

  it("redirects to /login after mount when no session tokens", async () => {
    mockAccessToken = null
    mockRefreshToken = null

    render(
      <RequireAuth>
        <span>protected content</span>
      </RequireAuth>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/login")
    })

    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })
})
