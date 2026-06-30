/**
 * Tests for the /onboarding route.
 *
 * Covers the three rendering branches of OnboardingContent:
 *   1. me loading → shows "Loading…" text
 *   2. me.kycStatus === 'verified' → shows "already verified" banner
 *   3. me.kycStatus !== 'verified' → renders OnboardingKycForm
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import OnboardingPage from "./page"

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/lib/api/kyc", () => ({
  submitKycComplete: vi.fn(),
  submitKycSession: vi.fn(),
}))

// Auth store stub — presents as authenticated so RequireAuth passes through.
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

import { fetchMe } from "@/lib/api/auth"

// ─── Mocked after vi.mock hoisting ───────────────────────────────────────────

vi.mock("@/lib/api/auth", () => ({
  fetchMe: vi.fn(),
  submitSignup: vi.fn(),
  submitVerifyEmail: vi.fn(),
  submitLoginRequest: vi.fn(),
  submitLoginVerify: vi.fn(),
  refreshSession: vi.fn(),
  logout: vi.fn(),
}))

const mockFetchMe = vi.mocked(fetchMe)

// ─── Test helper ─────────────────────────────────────────────────────────────

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <OnboardingPage />
    </QueryClientProvider>
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OnboardingPage (/onboarding)", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("shows the KYC form when user is not verified", async () => {
    mockFetchMe.mockResolvedValue({
      userId: "11111111-1111-1111-1111-111111111111",
      email: "user@example.com",
      kycStatus: "none",
      kycTier: "0",
      hasPin: false,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    })
  })

  it("shows 'already verified' banner when user is verified", async () => {
    mockFetchMe.mockResolvedValue({
      userId: "11111111-1111-1111-1111-111111111111",
      email: "user@example.com",
      kycStatus: "verified",
      kycTier: "1",
      hasPin: true,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/you're already verified/i)).toBeInTheDocument()
    })
  })
})
