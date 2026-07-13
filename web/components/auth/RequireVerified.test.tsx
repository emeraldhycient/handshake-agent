/**
 * TDD tests for RequireVerified — the app-shell tier gate.
 *
 * The onboarding redesign grants an email-verified user **tier_1** (buy /
 * receive) immediately, before any Sumsub document check. The gate must admit
 * any user who has cleared onboarding — a granted tier (`kycTier !== 'unverified'`)
 * AND a transaction PIN — into the app shell, and send everyone else back to the
 * onboarding wizard at `/get-started` to finish.
 *
 * The two funds-safety bounces it still enforces:
 * - a user with no granted tier (`kycTier === 'unverified'`) → `/get-started`;
 * - a user with a tier but no transaction PIN (`hasPin === false`) → `/get-started`
 *   (execute would otherwise throw an unrecoverable PinNotSetError — root §3.1).
 *
 * Money-moving stays server-gated per capability→min-tier (root §3.3); this gate
 * is app-shell admission UX, not the security boundary.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}))

let mockAccessToken: string | null = null
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = { accessToken: mockAccessToken }
    return selector ? selector(state) : state
  }),
}))

type MeShape = { kycTier: string; hasPin: boolean } | undefined
let mockMe: MeShape
let mockMeLoading = false
vi.mock("@/lib/query/auth", () => ({
  useMe: vi.fn(() => ({ data: mockMe, isLoading: mockMeLoading })),
}))

import { RequireVerified } from "./RequireVerified"

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RequireVerified", () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockAccessToken = null
    mockMe = undefined
    mockMeLoading = false
  })

  it("renders children for a tier_1 user with a PIN (email-verified is enough)", async () => {
    mockAccessToken = "tok"
    mockMe = { kycTier: "tier_1", hasPin: true }

    render(
      <RequireVerified>
        <span>protected content</span>
      </RequireVerified>
    )

    await waitFor(() => {
      expect(screen.getByText("protected content")).toBeInTheDocument()
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("renders children for a higher-tier (tier_2) user with a PIN", async () => {
    mockAccessToken = "tok"
    mockMe = { kycTier: "tier_2", hasPin: true }

    render(
      <RequireVerified>
        <span>protected content</span>
      </RequireVerified>
    )

    await waitFor(() => {
      expect(screen.getByText("protected content")).toBeInTheDocument()
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("redirects an unverified user (no granted tier) to /get-started", async () => {
    mockAccessToken = "tok"
    mockMe = { kycTier: "unverified", hasPin: false }

    render(
      <RequireVerified>
        <span>protected content</span>
      </RequireVerified>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/get-started")
    })
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })

  it("redirects a tier_1 user with no transaction PIN to /get-started", async () => {
    mockAccessToken = "tok"
    mockMe = { kycTier: "tier_1", hasPin: false }

    render(
      <RequireVerified>
        <span>protected content</span>
      </RequireVerified>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/get-started")
    })
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })

  it("renders nothing (RequireAuth handles it) when unauthenticated", () => {
    mockAccessToken = null
    mockMe = undefined

    render(
      <RequireVerified>
        <span>protected content</span>
      </RequireVerified>
    )

    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("shows a loading state while /me is still fetching", () => {
    mockAccessToken = "tok"
    mockMeLoading = true
    mockMe = undefined

    render(
      <RequireVerified>
        <span>protected content</span>
      </RequireVerified>
    )

    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})
