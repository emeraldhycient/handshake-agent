"use client"

import { useRouter } from "next/navigation"
import { KycSummary } from "@/components/onboarding/kyc-summary"

/**
 * /onboarding route — Phase 14.2.
 * Composition-only: renders KycSummary in a phone-width column
 * centered on a cream background. Router wiring lives here so
 * KycSummary stays presentational (§4 layering / CLAUDE.md §4.2).
 */
export default function OnboardingPage() {
  const router = useRouter()

  return (
    <main className="flex min-h-svh items-center justify-center bg-background">
      <div className="flex h-svh max-h-[844px] w-full max-w-[402px] flex-col overflow-hidden shadow-xl">
        <KycSummary onFinish={() => router.push("/app")} />
      </div>
    </main>
  )
}
