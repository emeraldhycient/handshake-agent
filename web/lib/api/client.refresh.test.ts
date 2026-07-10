/**
 * Axios client — 401 silent-refresh interceptor (Wave H: cookie-carried refresh).
 *
 * The refresh token now rides in the HttpOnly `ha_refresh` cookie, so:
 *   - the instance sends credentials on every request (`withCredentials`);
 *   - the 401 interceptor POSTs /auth/refresh with NO body (the cookie carries it);
 *   - it gates the refresh attempt on an in-memory access token so a business 401
 *     from an anonymous caller (or a wrong-PIN 401 in a test with no session) is
 *     normalised, not turned into a refresh storm;
 *   - on refresh failure it clears the session and rejects with SESSION_EXPIRED.
 *
 * The interceptor's rejected handler is invoked directly (as in
 * client.error-code.test.ts) so behaviour is exercised without a live server.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { api, ApiError, SESSION_EXPIRED_MESSAGE } from "./client"
import { defaultAuthStore } from "@/lib/store/auth-store"

function rejectedHandler(): (err: unknown) => Promise<unknown> {
  const { handlers } = api.interceptors.response as unknown as {
    handlers: Array<{ rejected?: (err: unknown) => Promise<unknown> }>
  }
  const rejected = handlers[0]?.rejected
  if (!rejected) throw new Error("response interceptor not registered")
  return rejected
}

const mockUser = {
  userId: "00000000-0000-0000-0000-000000000001",
  email: "u@example.com",
  kycStatus: "verified" as const,
  kycTier: "tier1",
  hasPin: true,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("api client — cookie refresh interceptor", () => {
  it("sends credentials (the ha_refresh cookie) with every request", () => {
    expect(api.defaults.withCredentials).toBe(true)
  })

  it("on a 401 from a protected endpoint with a session, refreshes with NO body then retries", async () => {
    const setAccessToken = vi.fn()
    const clear = vi.fn()
    vi.spyOn(defaultAuthStore, "getState").mockReturnValue({
      accessToken: "expired-access",
      user: null,
      status: "authenticated",
      setAccessToken,
      setSession: vi.fn(),
      setUser: vi.fn(),
      clear,
    })

    // The refresh POST resolves with a rotated access token (+ echoed body).
    const postSpy = vi.spyOn(api, "post").mockResolvedValueOnce({
      data: { accessToken: "new-access", refreshToken: "rotated", user: mockUser },
    } as never)

    // A per-request adapter makes the retry resolve without touching the network.
    const adapter = vi.fn().mockResolvedValue({
      data: { ok: true },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    })
    const config = {
      url: "/wallets/balances",
      method: "get",
      headers: {} as Record<string, string>,
      adapter,
    }
    const error = {
      config,
      response: { status: 401, data: {} },
      message: "Request failed with status code 401",
      isAxiosError: true,
    }

    await rejectedHandler()(error)

    // Refresh was POSTed with the URL only — NO body (the cookie carries the token).
    expect(postSpy).toHaveBeenCalledWith("/auth/refresh")
    expect(postSpy.mock.calls[0]).toHaveLength(1)
    // The rotated access token was stored.
    expect(setAccessToken).toHaveBeenCalledWith("new-access")
    // The original request was retried.
    expect(adapter).toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  it("does NOT attempt a refresh when there is no access token in memory", async () => {
    vi.spyOn(defaultAuthStore, "getState").mockReturnValue({
      accessToken: null,
      user: null,
      status: "anonymous",
      setAccessToken: vi.fn(),
      setSession: vi.fn(),
      setUser: vi.fn(),
      clear: vi.fn(),
    })
    const postSpy = vi.spyOn(api, "post")

    const error = {
      config: { url: "/wallets/balances", headers: {} },
      response: { status: 401, data: { message: "Unauthorized" } },
      message: "Request failed with status code 401",
    }

    const rejection = await rejectedHandler()(error).catch((e) => e)

    expect(postSpy).not.toHaveBeenCalled()
    expect(rejection).toBeInstanceOf(ApiError)
    expect((rejection as ApiError).message).toBe("Unauthorized")
  })

  it("clears the session and rejects SESSION_EXPIRED when the refresh fails", async () => {
    const clear = vi.fn()
    vi.spyOn(defaultAuthStore, "getState").mockReturnValue({
      accessToken: "expired-access",
      user: null,
      status: "authenticated",
      setAccessToken: vi.fn(),
      setSession: vi.fn(),
      setUser: vi.fn(),
      clear,
    })
    vi.spyOn(api, "post").mockRejectedValueOnce(new Error("refresh 401"))

    const error = {
      config: { url: "/wallets/balances", headers: {} },
      response: { status: 401, data: {} },
      message: "Request failed with status code 401",
    }

    const rejection = await rejectedHandler()(error).catch((e) => e)

    expect(clear).toHaveBeenCalled()
    expect(rejection).toBeInstanceOf(ApiError)
    expect((rejection as ApiError).status).toBe(401)
    expect((rejection as ApiError).message).toBe(SESSION_EXPIRED_MESSAGE)
  })

  it("does not refresh a 401 from an /auth/ endpoint (avoids recursion; keeps the server code)", async () => {
    vi.spyOn(defaultAuthStore, "getState").mockReturnValue({
      accessToken: "some-access",
      user: null,
      status: "authenticated",
      setAccessToken: vi.fn(),
      setSession: vi.fn(),
      setUser: vi.fn(),
      clear: vi.fn(),
    })
    const postSpy = vi.spyOn(api, "post")

    const error = {
      config: { url: "/auth/login/verify", headers: {} },
      response: { status: 401, data: { message: "Invalid code", code: "OTP_INVALID" } },
      message: "Request failed with status code 401",
    }

    const rejection = await rejectedHandler()(error).catch((e) => e)

    expect(postSpy).not.toHaveBeenCalled()
    expect((rejection as ApiError).code).toBe("OTP_INVALID")
  })
})
