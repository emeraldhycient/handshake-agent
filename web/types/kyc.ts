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
