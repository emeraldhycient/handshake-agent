"use client"

/**
 * RequireAuth — route guard for authenticated pages.
 *
 * Reads accessToken and refreshToken from the Zustand auth store:
 * - If neither is present → redirect to /login immediately.
 * - If refreshToken is present but accessToken is not → show a loading state
 *   (AuthProvider is likely still rehydrating).
 * - If accessToken is present → render children.
 *
 * Hydration note: the Zustand store initialises refreshToken from localStorage,
 * which is unavailable on the server. This means the server always sees an
 * anonymous state while the client may see a persisted session. To prevent
 * a hydration mismatch we render `null` before mount (matching the anonymous
 * server render) and only show auth-dependent UI after the client has mounted.
 *
 * Do NOT wrap public routes: /signup, /login, /verify-email, /kyc, /onboarding.
 */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/store/auth-store"

interface RequireAuthProps {
  children: React.ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  const router = useRouter()
  const accessToken = useAuthStore((s) => s.accessToken)
  const refreshToken = useAuthStore((s) => s.refreshToken)

  // Gate: render nothing until the client has mounted so the first paint
  // matches the server render (both anonymous). Auth-dependent branching
  // only happens after mount to avoid hydration mismatches.
  // The synchronous setState inside the effect is intentional: the mounted
  // flag must flip exactly once, on mount, to trigger the first auth-aware
  // render. This is the canonical hydration-safe client-only pattern.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const hasNoSession = !accessToken && !refreshToken

  useEffect(() => {
    if (mounted && hasNoSession) {
      router.push("/login")
    }
  }, [mounted, hasNoSession, router])

  // Pre-mount: render nothing — matches the server render (no localStorage).
  if (!mounted) {
    return null
  }

  // No session at all — redirect is in flight, render nothing
  if (hasNoSession) {
    return null
  }

  // Rehydration in progress (refreshToken present but accessToken not yet set)
  if (!accessToken && refreshToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return <>{children}</>
}
