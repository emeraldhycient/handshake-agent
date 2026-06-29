"use client"

/**
 * AuthProvider — session rehydration on mount.
 *
 * On mount: if a refreshToken is persisted (localStorage via the store) but
 * no accessToken is in memory, attempt a silent refresh and then fetch the
 * current user. On failure, clear the session so RequireAuth redirects to /login.
 *
 * Renders children immediately (does not block on rehydration) — RequireAuth
 * handles the redirect if auth is still missing once it mounts.
 *
 * Hydration note: the previous implementation called useState(needsRehydration)
 * which read localStorage during state initialisation. On the server localStorage
 * is unavailable so the initial value was always false; on the client it could
 * be true. This caused a server/client tree mismatch ("Hydration failed").
 * The fix: the component renders a stable, attribute-free wrapper and defers
 * all localStorage-dependent logic to a useEffect (client-only, post-hydration).
 */
import { useEffect, useRef } from "react"
import { defaultAuthStore } from "@/lib/store/auth-store"
import { refreshSession, fetchMe } from "@/lib/api/auth"

interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Ref to avoid running the effect twice in React 18/19 Strict Mode.
  const didRun = useRef(false)

  useEffect(() => {
    if (didRun.current) return
    didRun.current = true

    const { refreshToken, accessToken } = defaultAuthStore.getState()

    if (!refreshToken || accessToken) {
      // Nothing to do — already authenticated or no persisted session.
      return
    }

    refreshSession(refreshToken)
      .then(async (data) => {
        defaultAuthStore
          .getState()
          .setTokens(data.accessToken, data.refreshToken)
        try {
          const user = await fetchMe()
          defaultAuthStore.getState().setUser(user)
        } catch {
          // Profile fetch failed after token refresh — clear to avoid a
          // half-initialised session.
          defaultAuthStore.getState().clear()
        }
      })
      .catch(() => {
        // Refresh failed (expired, revoked, network error) — clear so
        // RequireAuth sends the user back to /login.
        defaultAuthStore.getState().clear()
      })
    // Empty dependency array is intentional — run once on mount only.
  }, [])

  return <>{children}</>
}
