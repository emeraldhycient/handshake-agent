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
    <main className="min-h-svh bg-background sm:flex sm:items-center sm:justify-center sm:p-6">
      {/* Full-bleed on mobile; framed phone-width preview only at sm+ (desktop). */}
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background sm:h-[min(100svh,844px)] sm:max-w-[402px] sm:rounded-[40px] sm:shadow-xl">
        <KycSummary onFinish={() => router.push("/app")} />
      </div>
    </main>
  )
}
