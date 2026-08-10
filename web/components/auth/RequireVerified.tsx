"use client"

/**
 * RequireVerified — app-shell admission gate.
 *
 * Must be nested INSIDE RequireAuth (which handles the unauthenticated case).
 * This guard handles the authenticated-but-not-fully-onboarded case.
 *
 * The onboarding redesign grants an email-verified user **tier_1** (buy /
 * receive) immediately (root §3.3 capability→min-tier ladder). So "cleared
 * onboarding" is: a granted tier (`kycTier !== 'unverified'`) AND a transaction
 * PIN. Anyone who has both is admitted into the app shell; per-capability
 * gating (send / sell / swap need tier_2+) is enforced server-side on every
 * money move, so admitting a tier_1 user here is UX, never the security
 * boundary.
 *
 * Behaviour:
 * - Not authenticated → do nothing (RequireAuth above this handles it).
 * - `me` still loading → show loading text (avoid premature redirect on stale state).
 * - `me` loaded AND `kycTier === 'unverified'` → redirect to /get-started
 *   (finish the wizard to earn tier_1).
 * - `me` loaded, has a tier, but `hasPin === false` → redirect to /get-started.
 *   A custodial money app must never let a PIN-less user reach the transaction
 *   surface: execute would throw an unrecoverable PinNotSetError. Routing them
 *   back to the wizard (which resumes at the PIN step) is funds-safety, not UX
 *   polish (root CLAUDE.md §3.1). The wizard's deriveResumeStep lands them on
 *   the set-PIN step.
 * - Otherwise → render children.
 *
 * Do NOT wrap public routes: /login, /verify-email, /kyc, /get-started.
 */
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/store/auth-store"
import { useMe } from "@/lib/query/auth"
import type { RequireVerifiedProps } from "@/types"

// The onboarding wizard. It resumes at the first unfinished step (deriveResumeStep),
// so a tier-less user lands on the KYC/verify step and a PIN-less user on set-PIN.
const ONBOARDING_ROUTE = "/get-started"

export function RequireVerified({ children }: RequireVerifiedProps) {
  const router = useRouter()
  const accessToken = useAuthStore((s) => s.accessToken)

  // Only query /me when authenticated; `enabled` in useMe handles this.
  const { data: me, isLoading } = useMe()

  const ready = !!accessToken && !isLoading && !!me
  // No granted tier yet — must finish onboarding to earn tier_1.
  const needsTier = ready && me.kycTier === "unverified"
  // Has a tier but no transaction PIN — must set one before the app.
  const needsPin = ready && me.kycTier !== "unverified" && me.hasPin === false
  const shouldRedirect = needsTier || needsPin

  useEffect(() => {
    if (shouldRedirect) {
      router.push(ONBOARDING_ROUTE)
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

  // Redirect to the onboarding wizard is in flight; render nothing.
  if (shouldRedirect) {
    return null
  }

  return <>{children}</>
}
