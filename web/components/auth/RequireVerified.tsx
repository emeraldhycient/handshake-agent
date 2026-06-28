"use client"

/**
 * RequireVerified — route guard for pages that require a verified KYC status.
 *
 * Must be nested INSIDE RequireAuth (which handles the unauthenticated case).
 * This guard handles the authenticated-but-unverified case.
 *
 * Behaviour:
 * - Not authenticated → do nothing (RequireAuth above this handles it).
 * - `me` still loading → show loading text (avoid premature redirect on stale state).
 * - `me` loaded AND `kycStatus !== 'verified'` → redirect to /onboarding.
 * - Otherwise → render children.
 *
 * Do NOT wrap public routes: /signup, /login, /verify-email, /kyc, /onboarding.
 */
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/store/auth-store"
import { useMe } from "@/lib/query/auth"

interface RequireVerifiedProps {
  children: React.ReactNode
}

export function RequireVerified({ children }: RequireVerifiedProps) {
  const router = useRouter()
  const accessToken = useAuthStore((s) => s.accessToken)

  // Only query /me when authenticated; `enabled` in useMe handles this.
  const { data: me, isLoading } = useMe()

  const shouldRedirect =
    !!accessToken && !isLoading && me?.kycStatus !== "verified"

  useEffect(() => {
    if (shouldRedirect) {
      router.push("/onboarding")
    }
  }, [shouldRedirect, router])

  // Not authenticated — RequireAuth above us handles the redirect; render nothing.
  if (!accessToken) {
    return null
  }

  // Still fetching /me — avoid a flash redirect.
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  // Redirect to /onboarding is in flight; render nothing.
  if (shouldRedirect) {
    return null
  }

  return <>{children}</>
}
