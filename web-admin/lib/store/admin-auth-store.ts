/**
 * Zustand admin-auth store — access token + resolved admin identity for the
 * Handshake admin console.
 *
 * Architecture notes (mirrors web/'s dual export):
 * - `createAdminAuthStore` is the testable vanilla factory (no React).
 *   Tests create isolated instances to avoid cross-test state pollution.
 * - `defaultAdminAuthStore` is the module-level singleton (vanilla StoreApi).
 *   Non-React code (the Axios interceptor) calls `.getState()` on it directly —
 *   which is why it MUST be a vanilla StoreApi, not a hook.
 * - `useAdminAuthStore` is the React hook bound to the singleton.
 *
 * Persistence: the admin access token is persisted to `sessionStorage` (key
 * `ha.admin.session`) — NOT localStorage. There is no refresh-token flow; the
 * token lives only for the browser session and is rehydrated on init so a page
 * reload keeps the operator signed in until the tab closes or the token 401s.
 * The `admin` identity is memory-only (re-fetched via GET /admin/me on load).
 */

import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"
import type { AdminMe } from "@handshake-agent/contracts"

// ─── SessionStorage key ────────────────────────────────────────────────────────

const ADMIN_SESSION_KEY = "ha.admin.session"

// ─── State interface ───────────────────────────────────────────────────────────

export interface AdminAuthState {
  accessToken: string | null
  admin: AdminMe | null
  status: "anonymous" | "authenticated"

  /**
   * Populate the session after a successful login. Persists the access token to
   * sessionStorage and transitions status to 'authenticated'.
   */
  setSession(payload: { accessToken: string; admin: AdminMe }): void

  /** Refresh just the cached admin identity (e.g. after a /admin/me re-fetch). */
  setAdmin(admin: AdminMe): void

  /**
   * Reset to the anonymous baseline and remove the persisted token. Called on
   * logout and on any 401 from the API.
   */
  clear(): void
}

// ─── SSR-safe sessionStorage helper ────────────────────────────────────────────

function readAccessToken(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage.getItem(ADMIN_SESSION_KEY)
  } catch {
    // SecurityError in sandboxed iframes, etc.
    return null
  }
}

function persistAccessToken(token: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (token === null) window.sessionStorage.removeItem(ADMIN_SESSION_KEY)
    else window.sessionStorage.setItem(ADMIN_SESSION_KEY, token)
  } catch {
    // Best-effort persistence; don't crash on quota / security errors.
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a vanilla Zustand admin-auth store.
 * Returns a `StoreApi<AdminAuthState>` — use `.getState()` / `.setState()`.
 *
 * Rehydrates the access token from sessionStorage on init so a reload keeps the
 * interceptor authenticated; `status` flips to 'authenticated' iff a token was
 * found (the admin identity is then re-fetched separately via GET /admin/me).
 */
export function createAdminAuthStore() {
  const rehydratedToken = readAccessToken()
  return createStore<AdminAuthState>()((set) => ({
    accessToken: rehydratedToken,
    admin: null,
    status: rehydratedToken ? "authenticated" : "anonymous",

    setSession({ accessToken, admin }) {
      persistAccessToken(accessToken)
      set({ accessToken, admin, status: "authenticated" })
    },

    setAdmin(admin) {
      set({ admin })
    },

    clear() {
      persistAccessToken(null)
      set({ accessToken: null, admin: null, status: "anonymous" })
    },
  }))
}

// ─── React singleton binding ────────────────────────────────────────────────────

/**
 * Module-level singleton vanilla store.
 * Non-React code (the Axios interceptor) imports and uses this directly.
 */
export const defaultAdminAuthStore = createAdminAuthStore()

export type AdminAuthStore = ReturnType<typeof createAdminAuthStore>

/**
 * React hook bound to the module-default singleton admin-auth store.
 *
 * @example
 *   const status = useAdminAuthStore((s) => s.status)
 *   const setSession = useAdminAuthStore((s) => s.setSession)
 */
export function useAdminAuthStore(): AdminAuthState
export function useAdminAuthStore<U>(selector: (state: AdminAuthState) => U): U
export function useAdminAuthStore<U>(
  selector?: (state: AdminAuthState) => U
): U | AdminAuthState {
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStore(defaultAdminAuthStore, selector)
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(defaultAdminAuthStore)
}
