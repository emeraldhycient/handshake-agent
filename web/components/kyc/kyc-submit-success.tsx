interface KycSubmitSuccessProps {
  /** Show the "return to WhatsApp" note (the web-handoff KYC flow). */
  returnToWhatsApp?: boolean
}

/** Post-submit confirmation shared by both KYC forms. */
export function KycSubmitSuccess({ returnToWhatsApp }: KycSubmitSuccessProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-4 rounded-xl border border-success bg-success-muted px-6 py-10 text-center"
    >
      <span className="text-4xl" aria-hidden="true">
        ✓
      </span>
      <h2 className="text-lg font-semibold text-success-foreground">
        Verification submitted
      </h2>
      <p className="text-sm text-muted-foreground">
        Your identity has been submitted for review. We will notify you once
        verification is complete.
      </p>
      {returnToWhatsApp && (
        <p className="mt-2 text-sm font-medium text-foreground">
          Return to WhatsApp to continue.
        </p>
      )}
    </div>
  )
}
