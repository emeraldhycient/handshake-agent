/**
 * Tests for the resend auth hooks (useResendLoginOtp / useResendVerification).
 *
 * Both post an email to a rate-limited, idempotent backend endpoint:
 *   useResendLoginOtp     → POST /auth/login/resend         → { status: "otp_sent" }
 *   useResendVerification → POST /auth/verify-email/resend  → { status: "pending_verification" }
 *
 * The hooks parse the request body and the response through the shared contracts
 * schemas (UX gate; the server is the security/rate-limit gate). We mock the
 * single axios instance so no real HTTP happens.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultAuthStore } from "@/lib/store/auth-store"
import { qk } from "./keys"

const post = vi.fn()
vi.mock("@/lib/api/client", () => ({
  api: {
    post: (...a: unknown[]) => post(...a),
    get: vi.fn(),
  },
}))

import {
  useResendLoginOtp,
  useResendVerification,
  useSignupRequest,
  useSignupVerify,
} from "./auth"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper }
}

describe("useResendLoginOtp", () => {
  beforeEach(() => post.mockReset())

  it("posts the email to /auth/login/resend and parses the otp_sent response", async () => {
    post.mockResolvedValue({ data: { status: "otp_sent" } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useResendLoginOtp(), { wrapper })

    const res = await result.current.mutateAsync({ email: "user@example.com" })

    expect(post).toHaveBeenCalledWith("/auth/login/resend", {
      email: "user@example.com",
    })
    expect(res.status).toBe("otp_sent")
  })

  it("rejects an invalid email before sending (UX parse gate)", async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useResendLoginOtp(), { wrapper })

    await expect(
      result.current.mutateAsync({ email: "not-an-email" })
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
})

describe("useResendVerification", () => {
  beforeEach(() => post.mockReset())

  it("posts the email to /auth/verify-email/resend and parses the pending_verification response", async () => {
    post.mockResolvedValue({ data: { status: "pending_verification" } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useResendVerification(), { wrapper })

    const res = await result.current.mutateAsync({ email: "user@example.com" })

    expect(post).toHaveBeenCalledWith("/auth/verify-email/resend", {
      email: "user@example.com",
    })
    expect(res.status).toBe("pending_verification")
  })
})

// Note: error/loading surfacing for these mutations is TanStack-standard
// (error / isError / isPending). The user-visible 429 / OTP_LOCKED messaging is
// asserted where it renders — in the VerifyEmailForm / LoginForm component tests
// — rather than re-testing the framework here.

// ─── OTP signup hooks — mirror useLoginRequest / useLoginVerify (task F0.1) ───

describe("useSignupRequest", () => {
  beforeEach(() => post.mockReset())

  it("posts the email to /auth/signup/request and parses the otp_sent response", async () => {
    post.mockResolvedValue({ data: { status: "otp_sent", devOtp: "111111" } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSignupRequest(), { wrapper })

    const res = await result.current.mutateAsync("newuser@example.com")

    expect(post).toHaveBeenCalledWith("/auth/signup/request", {
      email: "newuser@example.com",
    })
    expect(res.status).toBe("otp_sent")
    expect(res.devOtp).toBe("111111")
  })

  it("rejects an invalid email before sending (UX parse gate)", async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSignupRequest(), { wrapper })

    await expect(result.current.mutateAsync("not-an-email")).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
})

describe("useSignupVerify", () => {
  const verifyResponse = {
    accessToken: "signup-access",
    refreshToken: "signup-refresh",
    user: {
      userId: "00000000-0000-0000-0000-000000000002",
      email: "newuser@example.com",
      kycStatus: "none" as const,
      kycTier: "0",
      hasPin: false,
    },
  }

  beforeEach(() => {
    post.mockReset()
    defaultAuthStore.getState().clear()
  })

  afterEach(() => {
    defaultAuthStore.getState().clear()
  })

  it("posts email+otp+deviceFingerprint to /auth/signup/verify, stores the session, and invalidates 'me'", async () => {
    post.mockResolvedValue({ data: verifyResponse })
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSignupVerify(), { wrapper })

    await result.current.mutateAsync({
      email: "newuser@example.com",
      otp: "123456",
      deviceFingerprint: "web-test-fingerprint-00000000",
    })

    expect(post).toHaveBeenCalledWith("/auth/signup/verify", {
      email: "newuser@example.com",
      otp: "123456",
      deviceFingerprint: "web-test-fingerprint-00000000",
    })
    expect(defaultAuthStore.getState().accessToken).toBe("signup-access")
    expect(defaultAuthStore.getState().user?.email).toBe("newuser@example.com")
    expect(defaultAuthStore.getState().status).toBe("authenticated")
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.me })
  })
})
