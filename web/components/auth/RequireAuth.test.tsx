/**
 * RequireAuth — route guard driven by the auth store status (Wave H).
 *
 * With the refresh token in an HttpOnly cookie there is no JS signal to
 * distinguish "boot rehydration in flight" from "no session". The store status
 * provides it: 'loading' (boot refresh pending), 'authenticated', 'anonymous'.
 *   - loading       → show the loading branch (never redirect prematurely)
 *   - authenticated → render children
 *   - anonymous     → redirect to /login
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}))

let mockStatus: "loading" | "authenticated" | "anonymous" = "loading"

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = { status: mockStatus, accessToken: null }
    return selector ? selector(state) : state
  }),
}))

import { RequireAuth } from "./RequireAuth"

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RequireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPush.mockReset()
    mockStatus = "loading"
  })

  it("renders children when status is 'authenticated'", () => {
    mockStatus = "authenticated"

    render(
      <RequireAuth>
        <span>protected content</span>
      </RequireAuth>
    )

    expect(screen.getByText("protected content")).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("shows the loading branch while status is 'loading' (boot refresh in flight)", () => {
    mockStatus = "loading"

    render(
      <RequireAuth>
        <span>protected content</span>
      </RequireAuth>
    )

    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    // Must NOT redirect while the boot refresh is still resolving.
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("redirects to /login and renders nothing when status is 'anonymous'", async () => {
    mockStatus = "anonymous"

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
