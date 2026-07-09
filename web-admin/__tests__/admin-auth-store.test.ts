/**
 * admin-auth-store tests (Wave H — HttpOnly cookie migration).
 *
 * After the migration the store holds ONLY the resolved admin identity + status
 * in memory — there is NO access token in JS and NOTHING is persisted to
 * sessionStorage. The HttpOnly `ha_admin_session` cookie carries the session.
 */
import { describe, expect, it, beforeEach } from "vitest"
import type { AdminMe } from "@handshake-agent/contracts"

import { createAdminAuthStore } from "@/lib/store/admin-auth-store"

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

beforeEach(() => {
  window.sessionStorage.clear()
})

describe("admin-auth-store", () => {
  it("starts anonymous with no identity, no expiry, and no token field", () => {
    const store = createAdminAuthStore()
    const state = store.getState()

    expect(state.status).toBe("anonymous")
    expect(state.admin).toBeNull()
    expect(state.expiresAt).toBeNull()
    // No access token is retained anywhere on the state.
    expect((state as unknown as Record<string, unknown>).accessToken).toBeUndefined()
  })

  it("does NOT rehydrate from a legacy sessionStorage token on init", () => {
    window.sessionStorage.setItem("ha.admin.session", "legacy-token")

    const store = createAdminAuthStore()

    // The legacy token is ignored — a fresh store boots anonymous and probes
    // /admin/me via the cookie instead.
    expect(store.getState().status).toBe("anonymous")
    expect(
      (store.getState() as unknown as Record<string, unknown>).accessToken
    ).toBeUndefined()
  })

  it("setSession stores identity + expiresAt and flips to authenticated (no token persisted)", () => {
    const store = createAdminAuthStore()
    const expiresAt = new Date().toISOString()

    store.getState().setSession({ admin: ADMIN, expiresAt })

    const state = store.getState()
    expect(state.status).toBe("authenticated")
    expect(state.admin).toEqual(ADMIN)
    expect(state.expiresAt).toBe(expiresAt)
    // The session cookie is HttpOnly — nothing lands in sessionStorage.
    expect(window.sessionStorage.getItem("ha.admin.session")).toBeNull()
  })

  it("setSession keeps the prior expiry when re-called without one (boot rehydration)", () => {
    const store = createAdminAuthStore()

    // Boot rehydration (GET /admin/me) has no expiresAt — the identity still
    // authenticates the session.
    store.getState().setSession({ admin: ADMIN })

    const state = store.getState()
    expect(state.status).toBe("authenticated")
    expect(state.admin).toEqual(ADMIN)
    expect(state.expiresAt).toBeNull()
  })

  it("clear resets to the anonymous baseline", () => {
    const store = createAdminAuthStore()
    store.getState().setSession({ admin: ADMIN, expiresAt: "2026-01-01T00:00:00.000Z" })

    store.getState().clear()

    const state = store.getState()
    expect(state.status).toBe("anonymous")
    expect(state.admin).toBeNull()
    expect(state.expiresAt).toBeNull()
    expect(window.sessionStorage.getItem("ha.admin.session")).toBeNull()
  })
})
