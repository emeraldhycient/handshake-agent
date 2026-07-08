import { RESEND_COOLDOWN_SECONDS } from "@/constants/auth"
import type { LoginResendControlsProps } from "@/types/auth"

/** Resend-code control (with cooldown) + "use a different email" for step 2. */
export function LoginResendControls({
  resending,
  resendReady,
  resendSecondsLeft,
  onResend,
  onUseDifferentEmail,
}: LoginResendControlsProps) {
  return (
    <>
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          disabled={!resendReady || resending}
          aria-busy={resending}
          className="text-sm font-medium text-primary underline underline-offset-2 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          onClick={onResend}
        >
          {resending
            ? "Resending…"
            : resendReady
              ? "Resend code"
              : `Resend code in ${resendSecondsLeft ?? RESEND_COOLDOWN_SECONDS}s`}
        </button>
        <p className="text-xs text-muted-foreground">
          The code expires after a few minutes. Didn&apos;t get it? Check spam,
          or resend.
        </p>
      </div>

      <button
        type="button"
        className="text-center text-sm text-muted-foreground underline underline-offset-2"
        onClick={onUseDifferentEmail}
      >
        Use a different email
      </button>
    </>
  )
}
