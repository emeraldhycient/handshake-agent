"use client"

/**
 * MakerCheckerModal — flow modal confirm step (design template line 1214). An
 * amber shield-check icon, a from→to change-preview table (old struck-through in
 * danger tone, new in success tone), and Cancel / dark confirm CTA. The copy is
 * HONEST per `mode`: the default `immediate` states the change applies as soon as
 * the operator confirms (step-up-gated + audited); only a surface that actually
 * raises a ChangeRequest for a SECOND admin (four-eyes) passes `dual-control`
 * and may claim "enters Pending approval". Presentation only — `onSubmit` hands
 * off to the caller's real mutation.
 *
 * Built on the shared Dialog primitive (focus-trap + Esc close), 520px flow panel.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import type { MakerCheckerModalProps } from "@/types/components"

export function MakerCheckerModal({
  open,
  onOpenChange,
  title,
  diff,
  onSubmit,
  mode = "immediate",
}: MakerCheckerModalProps) {
  const dualControl = mode === "dual-control"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[520px] max-w-[94vw] gap-0 p-6"
      >
        <div className="mb-1 flex items-center gap-[11px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-swn text-twn">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M9 12l2 2 4-4M7 4h10a1 1 0 0 1 1 1v14l-6-3-6 3V5a1 1 0 0 1 1-1Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <DialogTitle>{title}</DialogTitle>
        </div>
        <DialogDescription className="my-2.5 mb-4 text-[13px] leading-normal text-ink2">
          {dualControl ? (
            <>
              This is a dual-control change. It will enter{" "}
              <b>Pending approval</b> and requires a second admin to approve
              before it takes effect.
            </>
          ) : (
            <>
              This change <b>applies immediately</b> once you confirm with
              step-up. It is audited.
            </>
          )}
        </DialogDescription>

        <div className="mb-[7px] text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
          Change preview
        </div>
        <div className="mb-3.5 overflow-hidden rounded-xl border border-line">
          {diff.map((d, i) => (
            <div
              key={`${d.field}-${i}`}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 border-b border-line2 px-3.5 py-[11px] last:border-b-0"
            >
              <div>
                <div className="text-[10.5px] font-semibold text-ink3">
                  {d.field}
                </div>
                <div className="font-mono text-[13px] font-bold text-tdn tabular-nums line-through opacity-70">
                  {d.from}
                </div>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
                className="text-ink3"
              >
                <path
                  d="M5 12h14m0 0-5-5m5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="text-right">
                <div className="text-[10.5px] font-semibold text-ink3">
                  &nbsp;
                </div>
                <div className="font-mono text-[13px] font-extrabold text-tok tabular-nums">
                  {d.to}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-1 flex gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-xl border border-line px-3 py-3 text-center text-sm font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            className="flex-[1.3] rounded-xl bg-btn-dark px-3 py-3 text-center text-sm font-extrabold text-white transition-colors hover:bg-btn-dark/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {dualControl ? "Submit for approval" : "Confirm change"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
