/**
 * /onboarding — legacy route, redirects to the unified onboarding wizard.
 *
 * Task F2.1: KYC onboarding now lives inside `/get-started`, which derives
 * its own resume step from `useMe()` (including already-verified users).
 * This route is kept only so old links/bookmarks still resolve.
 */
import { redirect } from "next/navigation"

export default function OnboardingPage() {
  redirect("/get-started")
}
