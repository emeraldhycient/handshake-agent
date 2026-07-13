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

/**
 * Maps an `OnboardingStep` onto an index into `ONBOARDING_STEP_TRACKER`, so
 * `OnboardingRail` (desktop) and `OnboardingProgress` (mobile) derive each
 * tracker row/segment's done/active/pending state from one source of truth
 * (Task F1.3) instead of duplicating the mapping.
 *
 * - `welcome` (before the tracker starts) → `-1`: nothing done, nothing active.
 * - one of the four tracked steps → its index (0–3).
 * - `kyc` / `sumsub` / `done` (past the tracker) → `ONBOARDING_STEP_TRACKER.length`,
 *   so every row reads as done and none as active (mirrors the mockup's
 *   `done` flag, which short-circuits the per-row `isDone` check).
 */
export function getOnboardingStageIndex(step: OnboardingStep): number {
  const index = ONBOARDING_STEP_TRACKER.findIndex((item) => item.step === step)
  if (index !== -1) return index
  if (step === "kyc" || step === "sumsub" || step === "done") {
    return ONBOARDING_STEP_TRACKER.length
  }
  return -1
}
