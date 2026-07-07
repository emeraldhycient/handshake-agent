"use client"

import { useRouter } from "next/navigation"

/**
 * `useRouter` outside an app-router provider throws an invariant. In the real app
 * the shells always render inside the router tree, but isolated tests mount them
 * without one. `useRouter` calls `useContext` before the throw, so wrapping the
 * call keeps hook order stable; on failure we return null and any router-driven
 * redirect becomes a no-op (the Axios interceptor still clears the session, so
 * RequireAuth redirects on next render).
 */
export function useOptionalRouter(): ReturnType<typeof useRouter> | null {
  try {
    return useRouter()
  } catch {
    return null
  }
}
