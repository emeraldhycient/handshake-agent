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

// ─── Step component props (Task F1.2) ──────────────────────────────────────
// Each step is presentational + testable in isolation: it reads/writes wizard
// fields via `data`/`setData` and advances via `onNext`/`onBack`/`onGoto`-style
// callbacks passed down by the wizard shell (Task F1.4), rather than consuming
// `useOnboardingMachine()` itself.

export interface WelcomeStepProps {
  /** Advance to the `email` step. */
  onNext: () => void
}

export interface EmailStepProps {
  data: OnboardingData
  setData: (patch: Partial<OnboardingData>) => void
  /** Advance to the `otp` step once the code has been sent. */
  onNext: () => void
}

export interface OtpStepProps {
  data: OnboardingData
  setData: (patch: Partial<OnboardingData>) => void
  /** Advance to the `name` step once the code is verified. */
  onNext: () => void
  /** Return to the `email` step. */
  onBack: () => void
}

export interface NameStepProps {
  data: OnboardingData
  setData: (patch: Partial<OnboardingData>) => void
  /** Advance to the `pin` step once the name is saved. */
  onNext: () => void
  /** Return to the `otp` step. */
  onBack: () => void
}

export interface PinStepProps {
  /**
   * Advance to the `kyc` choice step once the PIN is set. The PIN itself is
   * kept local to this step (never lifted into the wizard's shared `data`) —
   * there is no reason for a transaction PIN to linger in memory past the
   * mutation that consumes it.
   */
  onNext: () => void
  /** Return to the `name` step. */
  onBack: () => void
}

export interface KycChoiceStepProps {
  firstName?: string | null
  /** "Verify now" — the wizard shell wires this to `goto('sumsub')`. */
  onVerifyNow: () => void
  /** "Explore first, verify later" — wired to `setData({kycChoice:'later'})` + `goto('done')`. */
  onVerifyLater: () => void
}

export interface DoneStepProps {
  firstName?: string | null
  /** From `MeResponse.kycStatus` — drives the status badge + subcopy. */
  kycStatus?: string
  /** True when the user picked "explore first, verify later" on the kyc-choice step. */
  skipped: boolean
  /** Launches Sumsub verification from the "Verify to unlock" banner. */
  onVerifyNow: () => void
}
