/**
 * TDD tests for RequireVerified — the verified-KYC route gate.
 *
 * Covers the funds-safety gap where a verified user WITHOUT a transaction PIN
 * (`hasPin: false`) passed the gate and later hit an unrecoverable
 * PinNotSetError at execute time. The gate must now route a PIN-less verified
 * user to the set-PIN flow, the same way it routes unverified users to
 * onboarding.
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

type MeShape = { kycStatus: string; hasPin: boolean } | undefined
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

  it("renders children when verified AND has a PIN", async () => {
    mockAccessToken = "tok"
    mockMe = { kycStatus: "verified", hasPin: true }

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

  it("redirects to /onboarding when not verified", async () => {
    mockAccessToken = "tok"
    mockMe = { kycStatus: "none", hasPin: false }

    render(
      <RequireVerified>
        <span>protected content</span>
      </RequireVerified>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/onboarding")
    })
    expect(screen.queryByText("protected content")).not.toBeInTheDocument()
  })

  it("redirects a verified-but-PIN-less user to the set-PIN flow, not into the app", async () => {
    mockAccessToken = "tok"
    mockMe = { kycStatus: "verified", hasPin: false }

    render(
      <RequireVerified>
        <span>protected content</span>
      </RequireVerified>
    )

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/onboarding")
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
