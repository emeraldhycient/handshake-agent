"use client"

/**
 * AuthProvider — session boot rehydration (Wave H: HttpOnly refresh cookie).
 *
 * On mount, if no access token is held in memory, attempt a single cookie-carried
 * refresh (POST /auth/refresh, no body — the HttpOnly `ha_refresh` cookie carries
 * the token). The response returns a fresh access token AND the user, so the
 * session is restored in one round-trip:
 *   - 200 → setSession(accessToken + user) → status 'authenticated'
 *   - failure (401 / network / 500) → clear() → status 'anonymous'
 *
 * Renders children immediately (does not block on the refresh). The store starts
 * in status 'loading'; RequireAuth shows the loading branch until this resolves,
 * then either renders the app or redirects to /login. Because the store no longer
 * reads localStorage, its initial state is identical on server and client — so
 * there is no SSR hydration mismatch and no attribute-based guard is needed.
 */
import { useEffect, useRef } from "react"
import { defaultAuthStore } from "@/lib/store/auth-store"
import { refreshSession } from "@/lib/api/auth"

interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Ref to avoid running the effect twice in React 18/19 Strict Mode.
  const didRun = useRef(false)

  useEffect(() => {
    if (didRun.current) return
    didRun.current = true

    // Already authenticated in memory (e.g. a fresh login before this provider's
    // first effect) — nothing to rehydrate.
    if (defaultAuthStore.getState().accessToken) return

    refreshSession()
      .then((data) => {
        defaultAuthStore
          .getState()
          .setSession({ accessToken: data.accessToken, user: data.user })
      })
      .catch(() => {
        // 401 (no/expired cookie) OR a network/server error — either way we
        // cannot establish a session, so resolve to anonymous. This also frees
        // the store from the 'loading' state so guards stop showing the spinner.
        defaultAuthStore.getState().clear()
      })
    // Empty dependency array is intentional — run once on mount only.
  }, [])

  return <>{children}</>
}
