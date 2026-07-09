/**
 * Admin auth mutation tests (Wave H — HttpOnly cookie migration).
 *
 * useAdminLogin: on success the server has Set-Cookie'd the session; the store
 * keeps ONLY the admin identity + expiresAt (never the token), and the shared me
 * query is seeded so the shell renders without a refetch.
 *
 * useAdminLogout: posts /admin/auth/logout (the API clears the cookie), then
 * clears the in-memory store and drops the cached identity — regardless of
 * whether the network call succeeded.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { AdminLoginResponse, AdminMe } from "@handshake-agent/contracts"

import { useAdminLogin, useAdminLogout } from "@/lib/query/auth"
import { defaultAdminAuthStore } from "@/lib/store/admin-auth-store"
import { qk } from "@/lib/query/keys"

vi.mock("@/lib/api/admin", () => ({ login: vi.fn(), logout: vi.fn() }))
import { login, logout } from "@/lib/api/admin"
const mockLogin = vi.mocked(login)
const mockLogout = vi.mocked(logout)

const ADMIN: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000aa", name: "ops" },
  status: "active",
  displayName: "Test Admin",
  mfaEnabled: false,
  permissions: [],
  menus: [],
  pages: [],
}

const LOGIN_RESPONSE: AdminLoginResponse = {
  accessToken: "server-only-token",
  expiresAt: "2026-07-09T13:00:00.000Z",
  admin: ADMIN,
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

beforeEach(() => {
  mockLogin.mockReset()
  mockLogout.mockReset()
  defaultAdminAuthStore.getState().clear()
})

describe("useAdminLogin", () => {
  it("stores identity + expiresAt (never the token) and seeds the me query", async () => {
    mockLogin.mockResolvedValue(LOGIN_RESPONSE)
    const { client, wrapper } = makeWrapper()

    const { result } = renderHook(() => useAdminLogin(), { wrapper })
    await result.current.mutateAsync({
      email: "admin@example.com",
      password: "supersecret",
    })

    const state = defaultAdminAuthStore.getState()
    expect(state.status).toBe("authenticated")
    expect(state.admin).toEqual(ADMIN)
    expect(state.expiresAt).toBe(LOGIN_RESPONSE.expiresAt)
    // The access token is never retained in JS — the cookie carries the session.
    expect((state as unknown as Record<string, unknown>).accessToken).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain("server-only-token")
    // The shell reads the seeded identity instead of refetching.
    expect(client.getQueryData(qk.me)).toEqual(ADMIN)
  })
})

describe("useAdminLogout", () => {
  it("posts logout, then clears the store and drops the cached identity", async () => {
    mockLogout.mockResolvedValue(undefined)
    const { client, wrapper } = makeWrapper()
    defaultAdminAuthStore.getState().setSession({ admin: ADMIN })
    client.setQueryData(qk.me, ADMIN)

    const { result } = renderHook(() => useAdminLogout(), { wrapper })
    await result.current.mutateAsync()

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(defaultAdminAuthStore.getState().status).toBe("anonymous")
    expect(defaultAdminAuthStore.getState().admin).toBeNull()
    expect(client.getQueryData(qk.me)).toBeUndefined()
  })

  it("still clears the session locally when the logout request fails", async () => {
    mockLogout.mockRejectedValue(new Error("network"))
    const { wrapper } = makeWrapper()
    defaultAdminAuthStore.getState().setSession({ admin: ADMIN })

    const { result } = renderHook(() => useAdminLogout(), { wrapper })
    await waitFor(() => expect(result.current.mutate).toBeTypeOf("function"))
    result.current.mutate()

    await waitFor(() =>
      expect(defaultAdminAuthStore.getState().status).toBe("anonymous")
    )
    expect(mockLogout).toHaveBeenCalledTimes(1)
  })
})
