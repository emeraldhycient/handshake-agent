/**
 * Zustand auth store — in-memory session state for the Handshake Agent web app.
 *
 * Wave H (HttpOnly refresh cookie): the refresh token no longer lives in JS. It
 * rides in the HttpOnly `ha_refresh` cookie the browser sends automatically with
 * every `withCredentials` request. This store therefore holds ONLY:
 *   - `accessToken` — short-lived bearer, memory-only (never persisted).
 *   - `user`        — cached identity projection.
 *   - `status`      — session lifecycle: 'loading' → 'authenticated' | 'anonymous'.
 *
 * There is NO refresh token in JS and NOTHING is written to localStorage. Session
 * survival across a page reload is handled by boot rehydration (AuthProvider calls
 * POST /auth/refresh; the cookie re-mints the access token + user).
 *
 * Architecture notes:
 * - `createAuthStore` is the testable vanilla factory (no React dependency).
 *   Tests create isolated instances to avoid cross-test state pollution.
 * - `defaultAuthStore` is the module-level singleton (vanilla StoreApi).
 *   Non-React code (Axios interceptors, etc.) calls `.getState()`/`.setState()`
 *   on this directly — this is why it MUST be a vanilla StoreApi, not a hook.
 * - `useAuthStore` is the React hook bound to the singleton.
 */

import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"
import type { MeResponse } from "@handshake-agent/contracts/auth"

// ─── State interface ──────────────────────────────────────────────────────────

/**
 * Session lifecycle:
 * - `loading`       — boot rehydration in flight; the cookie refresh has not yet
 *                     resolved. Guards render a loading branch (never redirect).
 * - `authenticated` — a valid access token is held in memory.
 * - `anonymous`     — the boot refresh resolved to no session, or the user logged
 *                     out / the session expired. Guards redirect to /login.
 */
export type AuthStatus = "loading" | "authenticated" | "anonymous"

export interface AuthState {
  accessToken: string | null
  user: MeResponse | null
  status: AuthStatus

  /**
   * Fully populate the session after a login / boot refresh that returns the
   * user. Sets accessToken + user and transitions status to 'authenticated'.
   * The refresh token is intentionally absent — it lives only in the cookie.
   */
  setSession(payload: { accessToken: string; user: MeResponse }): void

  /**
   * Update the in-memory access token only (and mark authenticated). Called by
   * the Axios interceptor after a silent cookie refresh, which rotates the
   * refresh cookie server-side and returns just a fresh access token to hold.
   */
  setAccessToken(token: string): void

  /** Update the cached user profile only (e.g. after a KYC status change). */
  setUser(user: MeResponse): void

  /**
   * Reset to the anonymous baseline. Called on logout / session expiry, and by
   * boot rehydration when the cookie refresh returns no session.
   */
  clear(): void
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a vanilla Zustand auth store.
 * Returns a `StoreApi<AuthState>` — use `.getState()` / `.setState()` / `.subscribe()`.
 *
 * The initial state is deterministic (no localStorage read), so it is identical
 * on the server and the client — which keeps SSR hydration free of mismatches.
 *
 * @example (test)
 *   const store = createAuthStore()
 *   store.getState().setSession({ accessToken: 'a', user: mockUser })
 */
export function createAuthStore() {
  return createStore<AuthState>()((set) => ({
    // ── Initial state ──────────────────────────────────────────────────────────
    // 'loading' until the boot cookie refresh resolves. No token, no user.
    accessToken: null,
    user: null,
    status: "loading",

    // ── Actions ────────────────────────────────────────────────────────────────

    setSession({ accessToken, user }) {
      set({ accessToken, user, status: "authenticated" })
    },

    setAccessToken(token) {
      // Holding a valid access token means the session is authenticated — this
      // path runs on the axios silent refresh, so it MUST transition status,
      // otherwise the chat composer (which gates the real agent on status)
      // silently falls back to the mock.
      set({ accessToken: token, status: "authenticated" })
    },

    setUser(user) {
      set({ user })
    },

    clear() {
      set({ accessToken: null, user: null, status: "anonymous" })
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
  selector?: (state: AuthState) => U
): U | AuthState {
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStore(defaultAuthStore, selector)
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(defaultAuthStore)
}
