"use client"

/**
 * RequireAuth — route guard for authenticated admin pages.
 *
 * Reads `status` from the admin-auth store:
 * - status !== 'authenticated' → redirect to /login.
 * - authenticated → render children.
 *
 * Hydration note: the store rehydrates the access token from sessionStorage,
 * unavailable on the server. The server always renders anonymous, so we render
 * nothing until the client has mounted to avoid a hydration mismatch, then
 * branch on the client-known status.
 */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { useAdminAuthStore } from "@/lib/store/admin-auth-store"
import type { RequireAuthProps } from "@/types/components"

export function RequireAuth({ children }: RequireAuthProps) {
  const router = useRouter()
  const status = useAdminAuthStore((s) => s.status)

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const unauthenticated = status !== "authenticated"

  useEffect(() => {
    if (mounted && unauthenticated) {
      router.push("/login")
    }
  }, [mounted, unauthenticated, router])

  // Pre-mount: render nothing — matches the anonymous server render.
  if (!mounted) return null

  // Redirect in flight — render nothing.
  if (unauthenticated) return null

  return <>{children}</>
}
