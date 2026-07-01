"use client"

/**
 * PiiRevealModal — flow modal PII-reveal step (design template line 1234). A red eye
 * icon, a "you are about to view encrypted-at-rest identity data" body, a danger
 * "PII access will be logged to the audit trail" strip, and Cancel / dark "Continue
 * to step-up" CTA. The title is fixed ("Reveal decrypted PII"); only the PII label
 * varies. Presentation only — `onContinue` hands off to the caller, which then opens
 * the StepUpModal before any decrypted value is shown, and the access is audited.
 *
 * Built on the shared Dialog primitive (focus-trap + Esc close), 520px flow panel.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PiiRevealModalProps } from "@/types/components"

export function PiiRevealModal({
  open,
  onOpenChange,
  piiLabel,
  onContinue,
}: PiiRevealModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[520px] max-w-[94vw] gap-0 p-6"
      >
        <div className="mb-2.5 flex items-center gap-[11px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-sdn text-tdn">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <circle
                cx="12"
                cy="12"
                r="2.6"
                stroke="currentColor"
                strokeWidth="1.7"
              />
            </svg>
          </span>
          <DialogTitle>Reveal decrypted PII</DialogTitle>
        </div>
        <DialogDescription className="mb-3.5 text-[13px] leading-normal text-ink2">
          You are about to view encrypted-at-rest identity data ({piiLabel}).
          This access is <b>logged and audited</b> against your admin account.
        </DialogDescription>

        <div className="mb-1.5 flex items-center gap-[9px] rounded-xl bg-sdn px-3.5 py-[11px]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="flex-none text-tdn"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="M12 8v5M12 16h.01"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-xs font-semibold text-tdn">
            PII access will be logged to the audit trail.
          </span>
        </div>

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-xl border border-line px-3 py-3 text-center text-sm font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="flex-[1.3] rounded-xl bg-btn-dark px-3 py-3 text-center text-sm font-extrabold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Continue to step-up
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
