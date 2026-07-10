/**
 * Zustand admin-auth store — the resolved admin identity + session status for
 * the Handshake admin console.
 *
 * Architecture notes (mirrors web/'s dual export):
 * - `createAdminAuthStore` is the testable vanilla factory (no React).
 *   Tests create isolated instances to avoid cross-test state pollution.
 * - `defaultAdminAuthStore` is the module-level singleton (vanilla StoreApi).
 *   Non-React code (the Axios interceptor) calls `.getState()` on it directly —
 *   which is why it MUST be a vanilla StoreApi, not a hook.
 * - `useAdminAuthStore` is the React hook bound to the singleton.
 *
 * Session persistence (Wave H): the admin session is carried by the HttpOnly
 * `ha_admin_session` cookie set by the API on login — NOT by JS. This store keeps
 * ONLY the resolved admin identity (+ the informational `expiresAt`) and the
 * `status` flag in memory; there is no access token in JS and nothing is written
 * to `sessionStorage`/`localStorage`. On a fresh page load the store boots
 * anonymous and the session is rehydrated by probing GET /admin/me with the
 * cookie (see `use-require-auth.ts`).
 */

import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"
import type { AdminMe } from "@handshake-agent/contracts"

// ─── State interface ───────────────────────────────────────────────────────────

export interface AdminAuthState {
  admin: AdminMe | null
  /** Informational session expiry from the login body (cookie holds the truth). */
  expiresAt: string | null
  status: "anonymous" | "authenticated"

  /**
   * Populate the session after a successful login OR a boot rehydration. Stores
   * the admin identity (and, when the login body supplies it, the expiry) and
   * transitions status to 'authenticated'. NO token is stored — the HttpOnly
   * cookie authenticates every subsequent request.
   */
  setSession(payload: { admin: AdminMe; expiresAt?: string | null }): void

  /**
   * Reset to the anonymous baseline. Called on logout (after POST
   * /admin/auth/logout clears the cookie) and on any 401 from the API.
   */
  clear(): void
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a vanilla Zustand admin-auth store.
 * Returns a `StoreApi<AdminAuthState>` — use `.getState()` / `.setState()`.
 *
 * Boots anonymous: there is no token to rehydrate from storage. Authentication
 * is established by login (`setSession`) or by the boot probe of GET /admin/me.
 */
export function createAdminAuthStore() {
  return createStore<AdminAuthState>()((set) => ({
    admin: null,
    expiresAt: null,
    status: "anonymous",

    setSession({ admin, expiresAt }) {
      set((state) => ({
        admin,
        expiresAt: expiresAt ?? state.expiresAt,
        status: "authenticated",
      }))
    },

    clear() {
      set({ admin: null, expiresAt: null, status: "anonymous" })
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
