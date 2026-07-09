/**
 * Auth store — TDD test suite (Wave H: HttpOnly refresh cookie)
 *
 * The refresh token no longer lives in JS. It rides in the HttpOnly `ha_refresh`
 * cookie the browser sends automatically. The store therefore keeps ONLY the
 * in-memory access token, the cached user, and a session status. It must never
 * read or write a refresh token to localStorage.
 *
 * Tests run under jsdom (globals: true) so localStorage is available — we assert
 * the store leaves it untouched.
 */

import { beforeEach, describe, expect, it } from "vitest"
import type { MeResponse } from "@handshake-agent/contracts/auth"
import { createAuthStore } from "./auth-store"

// ─── Test fixtures ────────────────────────────────────────────────────────────

// The legacy key the pre-Wave-H store used to persist the refresh token. The new
// store must never touch it.
const LEGACY_REFRESH_KEY = "ha.refreshToken"

const mockUser: MeResponse = {
  userId: "00000000-0000-0000-0000-000000000001",
  email: "test@handshake.ng",
  kycStatus: "approved",
  kycTier: "tier1",
  hasPin: false,
  firstName: null,
  lastName: null,
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("auth store (cookie refresh — no localStorage)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ─── initial state ──────────────────────────────────────────────────────────

  it("starts in status='loading' with null accessToken/user (boot rehydration pending)", () => {
    const s = createAuthStore().getState()

    expect(s.accessToken).toBeNull()
    expect(s.user).toBeNull()
    // 'loading' is the boot state: the app must attempt a cookie refresh before
    // it can know whether the user is authenticated. Guards render a loading
    // branch (never a premature /login redirect) while status is 'loading'.
    expect(s.status).toBe("loading")
  })

  it("exposes no refreshToken field (the refresh token lives only in the cookie)", () => {
    const s = createAuthStore().getState() as unknown as Record<string, unknown>
    expect("refreshToken" in s).toBe(false)
  })

  it("ignores a legacy persisted refresh token — never reads localStorage on creation", () => {
    localStorage.setItem(LEGACY_REFRESH_KEY, "legacy-refresh-token")

    const s = createAuthStore().getState()

    // A stale pre-migration key must NOT resurrect a session.
    expect(s.accessToken).toBeNull()
    expect(s.status).toBe("loading")
  })

  // ─── setSession ─────────────────────────────────────────────────────────────

  it("setSession sets accessToken + user + status='authenticated'", () => {
    const store = createAuthStore()

    store.getState().setSession({ accessToken: "access-token-abc", user: mockUser })

    const s = store.getState()
    expect(s.accessToken).toBe("access-token-abc")
    expect(s.user).toEqual(mockUser)
    expect(s.status).toBe("authenticated")
  })

  it("setSession writes nothing to localStorage", () => {
    const store = createAuthStore()

    store.getState().setSession({ accessToken: "access-token-abc", user: mockUser })

    expect(localStorage.length).toBe(0)
    expect(localStorage.getItem(LEGACY_REFRESH_KEY)).toBeNull()
  })

  // ─── setAccessToken ─────────────────────────────────────────────────────────

  it("setAccessToken updates only accessToken, leaving user, and marks authenticated", () => {
    const store = createAuthStore()
    store.getState().setSession({ accessToken: "old-access", user: mockUser })

    store.getState().setAccessToken("new-access-token")

    const s = store.getState()
    expect(s.accessToken).toBe("new-access-token")
    expect(s.status).toBe("authenticated")
    expect(s.user).toEqual(mockUser)
  })

  it("setAccessToken transitions loading→authenticated (a valid token = a session)", () => {
    // The axios silent-refresh interceptor calls setAccessToken after rotating
    // the cookie; it MUST mark the session authenticated or the chat composer
    // silently falls back to the mock agent path.
    const store = createAuthStore()

    store.getState().setAccessToken("fresh-access")

    expect(store.getState().status).toBe("authenticated")
    expect(store.getState().accessToken).toBe("fresh-access")
  })

  it("setAccessToken writes nothing to localStorage", () => {
    const store = createAuthStore()
    store.getState().setAccessToken("fresh-access")
    expect(localStorage.length).toBe(0)
  })

  // ─── setUser ────────────────────────────────────────────────────────────────

  it("setUser updates only the user field", () => {
    const store = createAuthStore()
    store.getState().setSession({ accessToken: "at", user: mockUser })

    const updatedUser: MeResponse = { ...mockUser, hasPin: true, kycTier: "tier2" }
    store.getState().setUser(updatedUser)

    const s = store.getState()
    expect(s.user).toEqual(updatedUser)
    expect(s.accessToken).toBe("at")
    expect(s.status).toBe("authenticated")
  })

  // ─── clear ──────────────────────────────────────────────────────────────────

  it("clear() resets to status='anonymous' with null accessToken/user", () => {
    const store = createAuthStore()
    store.getState().setSession({ accessToken: "access-token-abc", user: mockUser })

    store.getState().clear()

    const s = store.getState()
    expect(s.accessToken).toBeNull()
    expect(s.user).toBeNull()
    // 'anonymous' (not 'loading') — the boot refresh has resolved to no session.
    expect(s.status).toBe("anonymous")
  })

  it("never leaves a refresh token in localStorage across the full lifecycle", () => {
    const store = createAuthStore()
    store.getState().setSession({ accessToken: "at", user: mockUser })
    store.getState().setAccessToken("at2")
    store.getState().clear()

    expect(localStorage.length).toBe(0)
  })
})
