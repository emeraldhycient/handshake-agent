export interface LoginRequestStepProps {
  /** Called after a code is sent — hands the email and any dev OTP to the parent. */
  onSent: (email: string, devOtp?: string) => void
  className?: string
}

export interface LoginResendControlsProps {
  resending: boolean
  resendReady: boolean
  resendSecondsLeft: number | null
  onResend: () => void
  onUseDifferentEmail: () => void
}

export interface LoginVerifyStepProps {
  email: string
  /** Dev OTP from the request step — prefills the field + shows a helper. */
  initialDevOtp?: string
  /** Return to step 1 to use a different email. */
  onUseDifferentEmail: () => void
  className?: string
}
