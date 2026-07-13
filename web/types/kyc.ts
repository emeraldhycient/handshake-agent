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
