/**
 * Zustand auth store — token + session state for Handshake Agent web app.
 *
 * Architecture notes:
 * - `createAuthStore` is the testable vanilla factory (no React dependency).
 *   Tests create isolated instances to avoid cross-test state pollution.
 * - `defaultAuthStore` is the module-level singleton (vanilla StoreApi).
 *   Non-React code (Axios interceptors, etc.) calls `.getState()`/`.setState()`
 *   on this directly — this is why it MUST be a vanilla StoreApi, not a hook.
 * - `useAuthStore` is the React hook bound to the singleton.
 * - localStorage key `ha.refreshToken` persists the refresh token across page
 *   reloads. The access token is memory-only (short-lived; not persisted).
 */

import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"
import type { MeResponse } from "@handshake-agent/contracts/auth"

// ─── LocalStorage key ─────────────────────────────────────────────────────────

const REFRESH_TOKEN_KEY = "ha.refreshToken"

// ─── State interface ──────────────────────────────────────────────────────────

export interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: MeResponse | null
  status: "anonymous" | "authenticated"

  /**
   * Fully populate the session after a successful login / token refresh that
   * returns a new user object. Sets all three session fields, transitions
   * status to 'authenticated', and persists refreshToken to localStorage.
   */
  setSession(payload: {
    accessToken: string
    refreshToken: string
    user: MeResponse
  }): void

  /**
   * Update the in-memory access token only. Called by the Axios interceptor
   * after a silent token refresh where the response contains only a new
   * accessToken and no new user object (or when the caller already has the
   * latest user separately).
   */
  setAccessToken(token: string): void

  /**
   * Update both tokens (access + refresh) without touching status or user.
   * Used by the Axios refresh interceptor (Task 4) which receives a new token
   * pair but must not overwrite a possibly-stale user object.
   * Persists the new refreshToken to localStorage.
   */
  setTokens(accessToken: string, refreshToken: string): void

  /** Update the cached user profile only (e.g. after KYC status change). */
  setUser(user: MeResponse): void

  /**
   * Reset everything to the anonymous baseline and remove the persisted
   * refresh token from localStorage. Called on logout / session expiry.
   */
  clear(): void
}

// ─── SSR-safe localStorage helper ────────────────────────────────────────────

function readRefreshToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  } catch {
    // SecurityError in sandboxed iframes, etc.
    return null
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a vanilla Zustand auth store.
 * Returns a `StoreApi<AuthState>` — use `.getState()` / `.setState()` / `.subscribe()`.
 *
 * @example (test)
 *   const store = createAuthStore()
 *   store.getState().setSession({ accessToken: 'a', refreshToken: 'r', user: mockUser })
 */
export function createAuthStore() {
  return createStore<AuthState>()((set) => ({
    // ── Initial state ──────────────────────────────────────────────────────────
    // Rehydrate refreshToken from localStorage so the Axios interceptor can
    // attempt a silent refresh on the first page load without requiring the
    // user to log in again.
    accessToken: null,
    refreshToken: readRefreshToken(),
    user: null,
    status: "anonymous",

    // ── Actions ────────────────────────────────────────────────────────────────

    setSession({ accessToken, refreshToken, user }) {
      try {
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
      } catch {
        // Best-effort persistence; don't crash on storage quota errors.
      }
      set({ accessToken, refreshToken, user, status: "authenticated" })
    },

    setAccessToken(token) {
      set({ accessToken: token })
    },

    setTokens(accessToken, refreshToken) {
      try {
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
      } catch {
        // Best-effort.
      }
      set({ accessToken, refreshToken })
    },

    setUser(user) {
      set({ user })
    },

    clear() {
      try {
        localStorage.removeItem(REFRESH_TOKEN_KEY)
      } catch {
        // Best-effort.
      }
      set({
        accessToken: null,
        refreshToken: null,
        user: null,
        status: "anonymous",
      })
    },
  }))
}

// ─── React singleton binding ──────────────────────────────────────────────────

/**
 * Module-level singleton vanilla store.
 * Non-React code (Axios interceptors, server actions, etc.) should import and
 * use this directly via `.getState()` / `.setState()`.
 *
 * Components: use `useAuthStore(selector)` or `useAuthStore()`.
 */
export const defaultAuthStore = createAuthStore()

export type AuthStore = ReturnType<typeof createAuthStore>

/**
 * React hook bound to the module-default singleton auth store.
 *
 * @example
 *   const status = useAuthStore(s => s.status)
 *   const setSession = useAuthStore(s => s.setSession)
 */
export function useAuthStore(): AuthState
export function useAuthStore<U>(selector: (state: AuthState) => U): U
export function useAuthStore<U>(
  selector?: (state: AuthState) => U,
): U | AuthState {
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStore(defaultAuthStore, selector)
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(defaultAuthStore)
}
