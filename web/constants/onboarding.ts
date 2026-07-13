import type { OnboardingStep, OnboardingTrackerItem } from "@/types"

/**
 * The linear step order the `next`/`back` transitions walk (root CLAUDE.md
 * §16 — no magic inline arrays in components). `sumsub` is deliberately
 * excluded: it is only reachable via an explicit `goto("sumsub")` from the
 * `kyc` choice step, never via `next()`.
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStep[] = [
  "welcome",
  "email",
  "otp",
  "name",
  "pin",
  "kyc",
  "done",
] as const

/**
 * Desktop rail vertical step-tracker (`OnboardingRail`, Task F1.3). Matches
 * the mockup copy exactly — only the four data-collection steps are tracked;
 * welcome/kyc-choice/sumsub/done are full-screen moments outside the tracker.
 */
export const ONBOARDING_STEP_TRACKER: readonly OnboardingTrackerItem[] = [
  { step: "email", label: "Your email" },
  { step: "otp", label: "Verify email" },
  { step: "name", label: "Your name" },
  { step: "pin", label: "Set PIN" },
] as const
