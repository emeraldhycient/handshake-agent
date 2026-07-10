/**
 * Auth API client — refreshSession (Wave H: cookie-carried refresh).
 *
 * refreshSession must POST /auth/refresh with NO body (the rotating refresh token
 * rides in the HttpOnly cookie) and return the parsed response, which now carries
 * both the fresh access token and the user projection.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { api } from "./client"
import { refreshSession } from "./auth"

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
