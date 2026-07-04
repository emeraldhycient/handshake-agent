"use client"

/**
 * useRequireAuth — the authentication half of the centralized admin guard.
 *
 * Reads `status` from the admin-auth store and redirects to `/login` when the
 * operator is not authenticated. Returns the resolved phase so the caller (AppShell)
 * can render nothing until the client has mounted + confirmed the session, avoiding a
 * hydration mismatch (the server always renders anonymous; the token rehydrates from
 * sessionStorage only on the client).
 *
 *  - "pending"        → not yet mounted; render nothing (matches the server render).
 *  - "redirecting"    → mounted + unauthenticated; a /login redirect is in flight.
 *  - "authenticated"  → safe to render the authenticated chrome.
 */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { useAdminAuthStore } from "@/lib/store/admin-auth-store"

export type AuthPhase = "pending" | "redirecting" | "authenticated"

export function useRequireAuth(): AuthPhase {
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
      router.replace("/login")
    }
  }, [mounted, unauthenticated, router])

  if (!mounted) return "pending"
  if (unauthenticated) return "redirecting"
  return "authenticated"
}
