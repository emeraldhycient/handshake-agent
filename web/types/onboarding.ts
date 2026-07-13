/**
 * The `/get-started` onboarding wizard: welcome → email → otp → name → pin →
 * kyc-choice → [sumsub] → done. `sumsub` is reachable only via an explicit
 * `goto` from `kyc` (the "verify now" choice) — it never sits in the linear
 * next/back order (root CLAUDE.md §16; plan `2026-07-13-onboarding-frontend.md`
 * Task F1.1).
 */
export type OnboardingStep =
  | "welcome"
  | "email"
  | "otp"
  | "name"
  | "pin"
  | "kyc"
  | "sumsub"
  | "done"

/** The "verify now" vs "explore first" choice on the `kyc` step. */
export type OnboardingKycChoice = "now" | "later"

/**
 * In-flight wizard fields collected across steps. Client-only UI state — the
 * server-side session (email verification, name, PIN, KYC tier) is the
 * source of truth once each step's API call succeeds; this just carries the
 * form values between steps within a single wizard run.
 */
export interface OnboardingData {
  email?: string
  otp?: string
  /** Dev-mode OTP echo (AUTH_DEV_EXPOSE_OTP) — prefills the otp step in non-prod. */
  devOtp?: string
  firstName?: string
  lastName?: string
  kycChoice?: OnboardingKycChoice
}

/** Return shape of `useOnboardingMachine`. */
export interface OnboardingMachine {
  step: OnboardingStep
  data: OnboardingData
  setData(patch: Partial<OnboardingData>): void
  /** Advance along the linear step order. No-op at the last step. */
  next(): void
  /** Reverse along the linear step order. No-op at the first step. */
  back(): void
  /** Jump directly to a step (used for the kyc → sumsub branch). */
  goto(step: OnboardingStep): void
  /** Reset to `welcome` with empty wizard data. */
  restart(): void
}

/** One entry in the desktop rail's vertical step-tracker. */
export interface OnboardingTrackerItem {
  step: OnboardingStep
  label: string
}
