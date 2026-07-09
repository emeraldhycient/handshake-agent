/**
 * Admin Axios client tests (Wave H — HttpOnly cookie migration).
 *
 *  1. The instance sends credentials (`withCredentials: true`) so the browser
 *     attaches the HttpOnly `ha_admin_session` cookie on every request.
 *  2. No `Authorization` header is injected from a stored token — even when the
 *     store is "authenticated", the request carries no bearer (the cookie
 *     authenticates). The Idempotency-Key interceptor still runs on writes.
 *  3. A 401 on a non-login endpoint clears the admin store (re-login required).
 *
 * A custom axios adapter captures the fully-interceptor-processed request config
 * (and drives the response path) — no server, no real network.
 */
import { describe, expect, it, beforeEach, vi } from "vitest"
import type { InternalAxiosRequestConfig } from "axios"

import { api, ApiError } from "@/lib/api/client"
import { defaultAdminAuthStore } from "@/lib/store/admin-auth-store"

const ADMIN = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
  status: "active" as const,
  displayName: "Test Admin",
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

/** Install an adapter that resolves 200 and records the processed config. */
function captureAdapter() {
  const seen: { config?: InternalAxiosRequestConfig } = {}
  api.defaults.adapter = async (config) => {
    seen.config = config
    return {
      data: {},
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    }
  }
  return seen
}

beforeEach(() => {
  defaultAdminAuthStore.getState().clear()
  vi.unstubAllGlobals()
})

describe("admin api client", () => {
  it("sends credentials so the HttpOnly session cookie rides on every request", () => {
    expect(api.defaults.withCredentials).toBe(true)
  })

  it("attaches NO Authorization header even when the store is authenticated", async () => {
    defaultAdminAuthStore.getState().setSession({ admin: ADMIN })
    const seen = captureAdapter()

    await api.get("/admin/me")

    const headers = (seen.config?.headers ?? {}) as Record<string, unknown>
    expect(headers.Authorization).toBeUndefined()
    expect(headers.authorization).toBeUndefined()
  })

  it("still stamps an Idempotency-Key on non-GET requests (no auth header)", async () => {
    defaultAdminAuthStore.getState().setSession({ admin: ADMIN })
    const seen = captureAdapter()

    await api.post("/admin/roles", { name: "x" })

    const headers = (seen.config?.headers ?? {}) as Record<string, unknown>
    expect(headers["Idempotency-Key"]).toBeTruthy()
    expect(headers.Authorization).toBeUndefined()
  })

  it("clears the admin store on a 401 from a non-login endpoint", async () => {
    defaultAdminAuthStore.getState().setSession({ admin: ADMIN })
    expect(defaultAdminAuthStore.getState().status).toBe("authenticated")

    // Stub navigation: pathname "/login" makes the interceptor skip its redirect
    // (and jsdom's unimplemented location.assign is stubbed regardless).
    vi.stubGlobal("location", { pathname: "/login", assign: vi.fn() })

    api.defaults.adapter = async (config) => {
      return Promise.reject({
        isAxiosError: true,
        config,
        message: "Request failed with status code 401",
        response: {
          status: 401,
          data: { code: "ADMIN_SESSION_EXPIRED", message: "Session expired." },
          statusText: "Unauthorized",
          headers: {},
          config,
        },
      })
    }

    await expect(api.get("/admin/me")).rejects.toBeInstanceOf(ApiError)
    expect(defaultAdminAuthStore.getState().status).toBe("anonymous")
  })
})
