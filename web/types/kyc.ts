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

/**
 * Props for the modal wrapper (`components/kyc/SumsubVerificationDialog`) — opens
 * the Sumsub verification flow in a Dialog for a focused experience. Controlled
 * via `open`/`onOpenChange`; the dialog closes itself on `onSubmitted`.
 */
export interface SumsubVerificationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which rung to verify: tier_2 (doc + liveness) or tier_3 (proof of address). */
  level: import("@handshake-agent/contracts/dto").KycTierLevel
  /** Fired when the applicant submits inside the SDK (dialog then closes). */
  onSubmitted?: () => void
}
