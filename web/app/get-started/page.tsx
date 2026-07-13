/**
 * /get-started — the unified onboarding entry point.
 *
 * Server component — composition only, no business logic. Public: a
 * brand-new visitor must be able to start here without a session. The
 * OnboardingWizard owns the client boundary (it drives its own state
 * machine and reads `useMe()` to resume authenticated-but-incomplete users
 * mid-flow), so this page adds no auth guard — mirroring `/login` and the
 * (now-redirecting) `/signup`.
 */
import type { Metadata } from "next"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"

export const metadata: Metadata = {
  title: "Get started — Handshake Agent",
  description: "Set up your Handshake Agent wallet in a few quick steps.",
}

export default function GetStartedPage() {
  return (
    <main id="main-content">
      <OnboardingWizard />
    </main>
  )
}
