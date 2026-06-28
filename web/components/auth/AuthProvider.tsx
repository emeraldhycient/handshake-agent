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
 * `rehydrating` is initialised to true only when a refresh is actually needed,
 * avoiding a synchronous setState inside the effect body.
 */
import { useEffect, useRef, useState } from "react"
import { defaultAuthStore } from "@/lib/store/auth-store"
import { refreshSession, fetchMe } from "@/lib/api/auth"

interface AuthProviderProps {
  children: React.ReactNode
}

function needsRehydration(): boolean {
  const { refreshToken, accessToken } = defaultAuthStore.getState()
  return Boolean(refreshToken && !accessToken)
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Initialise to true only when a silent refresh will actually happen.
  // This avoids a synchronous setRehydrating(false) call inside the effect.
  const [rehydrating, setRehydrating] = useState(needsRehydration)
  // Ref to avoid running the effect twice in React 18 Strict Mode.
  const didRun = useRef(false)

  useEffect(() => {
    if (didRun.current) return
    didRun.current = true

    const { refreshToken, accessToken } = defaultAuthStore.getState()

    if (!refreshToken || accessToken) {
      // No rehydration needed — rehydrating was initialised to false already.
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
      .finally(() => {
        setRehydrating(false)
      })
    // Empty dependency array is intentional — run once on mount only.
  }, [])

  return (
    <div
      data-auth-rehydrating={rehydrating ? "true" : "false"}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  )
}
