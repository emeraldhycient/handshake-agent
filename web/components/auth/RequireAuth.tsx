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
 * Do NOT wrap public routes: /signup, /login, /verify-email, /kyc, /onboarding.
 */
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/store/auth-store"

interface RequireAuthProps {
  children: React.ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  const router = useRouter()
  const accessToken = useAuthStore((s) => s.accessToken)
  const refreshToken = useAuthStore((s) => s.refreshToken)

  const hasNoSession = !accessToken && !refreshToken

  useEffect(() => {
    if (hasNoSession) {
      router.push("/login")
    }
  }, [hasNoSession, router])

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
