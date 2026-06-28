"use client"

/**
 * /onboarding route — KYC onboarding for session-authenticated users.
 *
 * Gated: RequireAuth redirects unauthenticated visitors to /login.
 *
 * Rendering logic:
 * - me loading  → spinner/text
 * - me.kycStatus === 'verified' → "already verified" banner + link to /
 * - otherwise   → OnboardingKycForm
 *
 * Composition-only: business logic lives in OnboardingKycForm and useMe.
 */
import Link from "next/link"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { OnboardingKycForm } from "@/components/kyc/OnboardingKycForm"
import { useMe } from "@/lib/query/auth"

function OnboardingContent() {
  const { data: me, isLoading } = useMe()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (me?.kycStatus === "verified") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-success bg-success-muted px-6 py-10 text-center">
          <span className="text-4xl" aria-hidden="true">
            ✓
          </span>
          <h1 className="text-lg font-semibold text-success-foreground">
            You&apos;re already verified
          </h1>
          <p className="text-sm text-muted-foreground">
            Your identity is already verified. You can use all features.
          </p>
          <Link
            href="/"
            className="font-medium text-primary underline underline-offset-2"
          >
            Go to the app
          </Link>
        </div>
      </div>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-xl font-semibold text-foreground">
          Complete your verification
        </h1>
        <OnboardingKycForm />
      </div>
    </main>
  )
}

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <OnboardingContent />
    </RequireAuth>
  )
}
