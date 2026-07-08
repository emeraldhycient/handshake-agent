import Link from "next/link"

interface SignupSuccessProps {
  /** Dev-only verification token — renders a shortcut link when present. */
  devToken?: string
}

/** Post-signup "check your email" confirmation. */
export function SignupSuccess({ devToken }: SignupSuccessProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-4 rounded-xl border border-success bg-success/10 px-6 py-10 text-center"
    >
      <span className="text-4xl" aria-hidden="true">
        ✉
      </span>
      <h2 className="text-lg font-semibold text-foreground">
        Check your email
      </h2>
      <p className="text-sm text-muted-foreground">
        We sent a verification link to your email address. Click it to activate
        your account.
      </p>

      {devToken && (
        <div className="mt-4 w-full rounded-lg border-2 border-warn bg-warn/10 px-4 py-3 text-left">
          <p className="mb-2 text-xs font-semibold tracking-wide text-warn-foreground uppercase">
            Dev only
          </p>
          <Link
            href={`/verify-email?token=${devToken}`}
            className="text-sm font-medium text-primary underline underline-offset-2"
          >
            Dev: click to verify email
          </Link>
        </div>
      )}
    </div>
  )
}
