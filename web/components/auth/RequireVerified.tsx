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
 * - `me` loaded, verified, but `hasPin === false` → redirect to set a PIN.
 *   A custodial money app must never let a PIN-less user reach the transaction
 *   surface: execute would throw an unrecoverable PinNotSetError. Routing them
 *   to set a PIN first is funds-safety, not UX polish (root CLAUDE.md §3.1).
 * - Otherwise → render children.
 *
 * Do NOT wrap public routes: /signup, /login, /verify-email, /kyc, /onboarding.
 */
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/store/auth-store"
import { useMe } from "@/lib/query/auth"
import type { RequireVerifiedProps } from "@/types/components"

// Route that lets a user set their transaction PIN. /onboarding hosts the
// PIN-setting form today; a dedicated set-PIN route + a server endpoint to set a
// PIN on an already-verified user are tracked as a cross-layer need.
const SET_PIN_ROUTE = "/onboarding"

export function RequireVerified({ children }: RequireVerifiedProps) {
  const router = useRouter()
  const accessToken = useAuthStore((s) => s.accessToken)

  // Only query /me when authenticated; `enabled` in useMe handles this.
  const { data: me, isLoading } = useMe()

  const ready = !!accessToken && !isLoading && !!me
  const needsVerification = ready && me.kycStatus !== "verified"
  // Verified but no transaction PIN — must be sent to set one before the app.
  const needsPin = ready && me.kycStatus === "verified" && me.hasPin === false
  const shouldRedirect = needsVerification || needsPin

  useEffect(() => {
    if (needsVerification) {
      router.push("/onboarding")
    } else if (needsPin) {
      router.push(SET_PIN_ROUTE)
    }
  }, [needsVerification, needsPin, router])

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
