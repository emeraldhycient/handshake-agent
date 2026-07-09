/**
 * useRequireAuth boot-rehydration tests (Wave H — HttpOnly cookie migration).
 *
 * On a fresh load the store has no token (the session lives in the HttpOnly
 * cookie). The hook probes GET /admin/me ONCE with the cookie:
 *   - 200 → promote the store to authenticated → phase "authenticated".
 *   - 401 → phase "redirecting" + router.replace('/login').
 * When the store is already authenticated (just logged in), it never re-probes.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { AdminMe } from "@handshake-agent/contracts"

import { useRequireAuth } from "@/lib/hooks/use-require-auth"
import { defaultAdminAuthStore } from "@/lib/store/admin-auth-store"
import { ApiError } from "@/lib/api/client"
import { qk } from "@/lib/query/keys"

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock("@/lib/api/admin", () => ({ getMe: vi.fn() }))
import { getMe } from "@/lib/api/admin"
const mockGetMe = vi.mocked(getMe)

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

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

beforeEach(() => {
  mockReplace.mockReset()
  mockGetMe.mockReset()
  defaultAdminAuthStore.getState().clear()
})

describe("useRequireAuth boot rehydration", () => {
  it("probes /admin/me and authenticates when the cookie session is valid", async () => {
    mockGetMe.mockResolvedValue(ADMIN)
    const { client, wrapper } = makeWrapper()

    const { result } = renderHook(() => useRequireAuth(), { wrapper })

    // Boots into the loading branch before the probe resolves.
    expect(result.current).toBe("pending")

    await waitFor(() => expect(result.current).toBe("authenticated"))
    expect(mockGetMe).toHaveBeenCalledTimes(1)
    expect(defaultAdminAuthStore.getState().status).toBe("authenticated")
    expect(defaultAdminAuthStore.getState().admin).toEqual(ADMIN)
    // The probe seeds the shared me query so components don't refetch.
    expect(client.getQueryData(qk.me)).toEqual(ADMIN)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("redirects to /login when the probe returns 401 (no valid session)", async () => {
    mockGetMe.mockRejectedValue(
      new ApiError("Session expired.", 401, "ADMIN_SESSION_EXPIRED")
    )
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useRequireAuth(), { wrapper })

    await waitFor(() => expect(result.current).toBe("redirecting"))
    expect(mockReplace).toHaveBeenCalledWith("/login")
    expect(defaultAdminAuthStore.getState().status).toBe("anonymous")
  })

  it("does not probe when the store is already authenticated (post-login)", async () => {
    defaultAdminAuthStore.getState().setSession({ admin: ADMIN })
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useRequireAuth(), { wrapper })

    expect(result.current).toBe("authenticated")
    // A short settle window to prove no probe fires.
    await new Promise((r) => setTimeout(r, 20))
    expect(mockGetMe).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("redirects after the store is cleared (logout) without re-probing", async () => {
    mockGetMe.mockResolvedValue(ADMIN)
    const { wrapper } = makeWrapper()

    const { result } = renderHook(() => useRequireAuth(), { wrapper })
    await waitFor(() => expect(result.current).toBe("authenticated"))
    expect(mockGetMe).toHaveBeenCalledTimes(1)

    // Simulate logout clearing the store.
    defaultAdminAuthStore.getState().clear()

    await waitFor(() => expect(result.current).toBe("redirecting"))
    expect(mockReplace).toHaveBeenCalledWith("/login")
    // No second probe — logout is an explicit sign-out, not a session check.
    expect(mockGetMe).toHaveBeenCalledTimes(1)
  })
})
