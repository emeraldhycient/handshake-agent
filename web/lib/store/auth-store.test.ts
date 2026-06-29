/**
 * Auth store — TDD test suite
 *
 * Tests run under jsdom (globals: true) so localStorage is available.
 * Each test creates a fresh store via `createAuthStore()` to prevent
 * cross-test pollution from the module-level singleton.
 */

import { beforeEach, describe, expect, it } from "vitest"
import type { MeResponse } from "@handshake-agent/contracts/auth"
import { createAuthStore } from "./auth-store"

// ─── Test fixtures ────────────────────────────────────────────────────────────

const REFRESH_KEY = "ha.refreshToken"

const mockUser: MeResponse = {
  userId: "00000000-0000-0000-0000-000000000001",
  email: "test@handshake.ng",
  kycStatus: "approved",
  kycTier: "tier1",
  hasPin: false,
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("auth store", () => {
  beforeEach(() => {
    // Reset localStorage before each test to prevent state leakage.
    localStorage.clear()
  })

  // ─── initial state ──────────────────────────────────────────────────────────

  it("starts with anonymous status and null tokens when localStorage is empty", () => {
    const store = createAuthStore()
    const s = store.getState()

    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.user).toBeNull()
    expect(s.status).toBe("anonymous")
  })

  // ─── rehydration ────────────────────────────────────────────────────────────

  it("rehydrates refreshToken from localStorage on creation", () => {
    localStorage.setItem(REFRESH_KEY, "persisted-refresh-token")

    const store = createAuthStore()
    const s = store.getState()

    // refreshToken is populated from storage; everything else still null/anonymous.
    expect(s.refreshToken).toBe("persisted-refresh-token")
    expect(s.accessToken).toBeNull()
    expect(s.user).toBeNull()
    expect(s.status).toBe("anonymous")
  })

  // ─── setSession ─────────────────────────────────────────────────────────────

  it("setSession populates all fields and sets status='authenticated'", () => {
    const store = createAuthStore()

    store.getState().setSession({
      accessToken: "access-token-abc",
      refreshToken: "refresh-token-xyz",
      user: mockUser,
    })

    const s = store.getState()
    expect(s.accessToken).toBe("access-token-abc")
    expect(s.refreshToken).toBe("refresh-token-xyz")
    expect(s.user).toEqual(mockUser)
    expect(s.status).toBe("authenticated")
  })

  it("setSession persists refreshToken to localStorage", () => {
    const store = createAuthStore()

    store.getState().setSession({
      accessToken: "access-token-abc",
      refreshToken: "refresh-token-xyz",
      user: mockUser,
    })

    expect(localStorage.getItem(REFRESH_KEY)).toBe("refresh-token-xyz")
  })

  // ─── setAccessToken ─────────────────────────────────────────────────────────

  it("setAccessToken updates only accessToken, does not change status or user", () => {
    const store = createAuthStore()

    // Establish a known session first.
    store.getState().setSession({
      accessToken: "old-access",
      refreshToken: "refresh-token-xyz",
      user: mockUser,
    })

    store.getState().setAccessToken("new-access-token")

    const s = store.getState()
    expect(s.accessToken).toBe("new-access-token")
    // Status and user must be unchanged.
    expect(s.status).toBe("authenticated")
    expect(s.user).toEqual(mockUser)
    // refreshToken must be unchanged.
    expect(s.refreshToken).toBe("refresh-token-xyz")
  })

  it("setAccessToken does not write to localStorage", () => {
    const store = createAuthStore()
    store.getState().setSession({
      accessToken: "old",
      refreshToken: "rt",
      user: mockUser,
    })
    localStorage.clear() // wipe it

    store.getState().setAccessToken("new-access")

    // localStorage should still be empty — setAccessToken has no side effects.
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  // ─── setTokens ──────────────────────────────────────────────────────────────

  it("setTokens updates both tokens without changing status or user", () => {
    const store = createAuthStore()

    // Establish a known session first.
    store.getState().setSession({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      user: mockUser,
    })

    store.getState().setTokens("new-access", "new-refresh")

    const s = store.getState()
    expect(s.accessToken).toBe("new-access")
    expect(s.refreshToken).toBe("new-refresh")
    // Status and user MUST NOT change.
    expect(s.status).toBe("authenticated")
    expect(s.user).toEqual(mockUser)
  })

  it("setTokens persists the new refreshToken to localStorage", () => {
    const store = createAuthStore()

    store.getState().setSession({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      user: mockUser,
    })

    store.getState().setTokens("new-access", "new-refresh")

    expect(localStorage.getItem(REFRESH_KEY)).toBe("new-refresh")
  })

  it("setTokens transitions status to authenticated (a valid token = a session)", () => {
    // Reload-time rehydration and the axios silent-refresh both call setTokens;
    // they MUST mark the session authenticated, or the chat composer falls back
    // to the mock agent path. (It still does not populate user — that is fetched
    // separately via /auth/me.)
    const store = createAuthStore()

    store.getState().setTokens("access", "refresh")

    const s = store.getState()
    expect(s.status).toBe("authenticated")
    expect(s.user).toBeNull()
  })

  it("setAccessToken transitions status to authenticated", () => {
    const store = createAuthStore()
    store.getState().setAccessToken("fresh-access")
    expect(store.getState().status).toBe("authenticated")
    expect(store.getState().accessToken).toBe("fresh-access")
  })

  // ─── setUser ────────────────────────────────────────────────────────────────

  it("setUser updates only the user field", () => {
    const store = createAuthStore()

    store.getState().setSession({
      accessToken: "at",
      refreshToken: "rt",
      user: mockUser,
    })

    const updatedUser: MeResponse = {
      ...mockUser,
      hasPin: true,
      kycTier: "tier2",
    }
    store.getState().setUser(updatedUser)

    const s = store.getState()
    expect(s.user).toEqual(updatedUser)
    // Other fields must be untouched.
    expect(s.accessToken).toBe("at")
    expect(s.refreshToken).toBe("rt")
    expect(s.status).toBe("authenticated")
  })

  // ─── clear ──────────────────────────────────────────────────────────────────

  it("clear() resets all fields to null/'anonymous'", () => {
    const store = createAuthStore()

    store.getState().setSession({
      accessToken: "access-token-abc",
      refreshToken: "refresh-token-xyz",
      user: mockUser,
    })

    store.getState().clear()

    const s = store.getState()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.user).toBeNull()
    expect(s.status).toBe("anonymous")
  })

  it("clear() removes 'ha.refreshToken' from localStorage", () => {
    const store = createAuthStore()

    store.getState().setSession({
      accessToken: "access-token-abc",
      refreshToken: "refresh-token-xyz",
      user: mockUser,
    })

    expect(localStorage.getItem(REFRESH_KEY)).toBe("refresh-token-xyz")

    store.getState().clear()

    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })
})
