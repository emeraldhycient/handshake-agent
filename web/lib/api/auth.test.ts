/**
 * Auth API client — refreshSession (Wave H: cookie-carried refresh) and the
 * OTP signup clients (submitSignupRequest / submitSignupVerify).
 *
 * refreshSession must POST /auth/refresh with NO body (the rotating refresh token
 * rides in the HttpOnly cookie) and return the parsed response, which now carries
 * both the fresh access token and the user projection.
 *
 * submitSignupRequest / submitSignupVerify mirror submitLoginRequest /
 * submitLoginVerify exactly, but hit the OTP-signup endpoints — the model
 * proposes nothing here, this is plain auth plumbing (root CLAUDE.md §3.1 does
 * not apply to session bootstrap).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { api } from "./client"
import { refreshSession, submitSignupRequest, submitSignupVerify } from "./auth"

afterEach(() => {
  vi.restoreAllMocks()
})

const refreshResponse = {
  accessToken: "fresh-access",
  refreshToken: "rotated-refresh",
  user: {
    userId: "00000000-0000-0000-0000-000000000001",
    email: "u@example.com",
    kycStatus: "verified" as const,
    kycTier: "tier1",
    hasPin: true,
  },
}

describe("refreshSession", () => {
  it("POSTs /auth/refresh with no body and returns the access token + user", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: refreshResponse } as never)

    const res = await refreshSession()

    expect(post).toHaveBeenCalledWith("/auth/refresh")
    // No second argument — the cookie carries the refresh token.
    expect(post.mock.calls[0]).toHaveLength(1)
    expect(res.accessToken).toBe("fresh-access")
    expect(res.user.email).toBe("u@example.com")
  })

  it("rejects when the response is missing the user projection", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { accessToken: "a", refreshToken: "r" },
    } as never)

    await expect(refreshSession()).rejects.toThrow()
  })
})

describe("submitSignupRequest", () => {
  it("POSTs email-only to /auth/signup/request and returns the otp_sent ack", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { status: "otp_sent" } } as never)

    const res = await submitSignupRequest("newuser@example.com")

    expect(post).toHaveBeenCalledWith("/auth/signup/request", {
      email: "newuser@example.com",
    })
    expect(res.status).toBe("otp_sent")
  })

  it("passes through devOtp when the backend is in dev-expose mode", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { status: "otp_sent", devOtp: "654321" },
    } as never)

    const res = await submitSignupRequest("newuser@example.com")

    expect(res.devOtp).toBe("654321")
  })

  it("rejects an invalid email before sending (UX parse gate)", async () => {
    const post = vi.spyOn(api, "post")

    await expect(submitSignupRequest("not-an-email")).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
})

describe("submitSignupVerify", () => {
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

  it("POSTs email+otp+deviceFingerprint to /auth/signup/verify and returns the session", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: verifyResponse } as never)

    const res = await submitSignupVerify({
      email: "newuser@example.com",
      otp: "123456",
      deviceFingerprint: "web-test-fingerprint-00000000",
    })

    expect(post).toHaveBeenCalledWith("/auth/signup/verify", {
      email: "newuser@example.com",
      otp: "123456",
      deviceFingerprint: "web-test-fingerprint-00000000",
    })
    expect(res.accessToken).toBe("signup-access")
    expect(res.user.email).toBe("newuser@example.com")
  })

  it("rejects a too-short deviceFingerprint before sending (UX parse gate)", async () => {
    const post = vi.spyOn(api, "post")

    await expect(
      submitSignupVerify({
        email: "newuser@example.com",
        otp: "123456",
        deviceFingerprint: "short",
      })
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("rejects when the response is missing the user projection", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { accessToken: "a", refreshToken: "r" },
    } as never)

    await expect(
      submitSignupVerify({
        email: "newuser@example.com",
        otp: "123456",
        deviceFingerprint: "web-test-fingerprint-00000000",
      })
    ).rejects.toThrow()
  })
})
