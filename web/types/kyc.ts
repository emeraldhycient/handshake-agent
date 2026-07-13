/**
 * The field shape shared by both KYC forms. Each concrete form's values are a
 * superset of this (KycForm adds `token`, OnboardingKycForm adds `confirmPin`),
 * so `KycFields` reads them via react-hook-form context typed to this shape.
 */
export interface KycFieldValues {
  firstName: string
  lastName: string
  dateOfBirth?: string
  nin?: string
  bvn?: string
  pin: string
  confirmPin?: string
}

export interface KycFieldsProps {
  /** Prefixes every field id so two forms can render distinct ids ("kyc" | "onb"). */
  idPrefix: string
  /** Render the Confirm-PIN field (onboarding sets its own PIN). */
  showConfirmPin?: boolean
  /** Date-of-birth input type — "date" (onboarding picker) or "text" (handoff). */
  dateOfBirthType?: "date" | "text"
  loading: boolean
}

/**
 * Props for the Sumsub WebSDK verification surface (`components/kyc/SumsubVerification`).
 * `level` selects which verification rung to run — `tier_2` (document + liveness)
 * or `tier_3` (proof of address). The engine grants the tier server-side off the
 * Sumsub webhook (root §3.1) — this component only collects; it never mutates tier.
 */
export interface SumsubVerificationProps {
  /** Which rung to verify: tier_2 (doc + liveness) or tier_3 (proof of address). */
  level: import("@handshake-agent/contracts/dto").KycTierLevel
  /** Fired when the applicant submits / the review completes inside the SDK. */
  onSubmitted?: () => void
  /** Back out of the verification surface (returns to the launching context). */
  onBack?: () => void
  className?: string
}
