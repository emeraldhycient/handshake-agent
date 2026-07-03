"use client"

/**
 * SettingValueModal — the value-capture step that precedes the audit chain (reason →
 * step-up → maker-checker) for an edit that changes a numeric config leaf (a tier cap,
 * a pricing spread). It captures the new value before dual-control, so the maker-checker
 * change-preview and the real PATCH both carry a concrete number.
 *
 * Built on the shared Dialog primitive (focus-trap + Esc close), styled like the other
 * flow modals (radius-20 panel, tokens only). Presentation only — it hands the entered
 * value up via `onValueChange` and advances on `onContinue`; the caller decides when the
 * value is valid (`canContinue`) and what key to persist. Continue is refused while the
 * value is invalid.
 *
 * One canonical value-capture step shared by every config-edit screen (root §13.1/§13.2)
 * — do not fork per-screen "new value" prompts.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

// The design's edit-pencil glyph (shared with the amount-cap rows).
const EDIT_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"

interface SettingValueModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The flow title (e.g. "Edit crypto.buy spread · USDT / NGN"). */
  title: string
  /** The field's label + a11y name (e.g. "New spread (basis points)"). */
  fieldLabel: string
  /** The current value shown as the reference (e.g. "1.00%" or "₦200,000"). */
  currentValue: string
  /** The controlled input value. */
  value: string
  onValueChange: (value: string) => void
  /** Whether the captured value is valid enough to advance (caller-decided). */
  canContinue: boolean
  onContinue: () => void
}

export function SettingValueModal({
  open,
  onOpenChange,
  title,
  fieldLabel,
  currentValue,
  value,
  onValueChange,
  canContinue,
  onContinue,
}: SettingValueModalProps) {
  const inputId = "setting-new-value"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[440px] max-w-[94vw] gap-0 p-6"
      >
        <div className="mb-1.5 flex items-center gap-[11px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-sif text-tif">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d={EDIT_ICON}
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <DialogTitle>{title}</DialogTitle>
        </div>
        <DialogDescription className="mb-4 text-[13px] leading-normal text-ink2">
          Enter the new value. The current value is{" "}
          <span className="font-mono font-bold text-ink tabular-nums">
            {currentValue}
          </span>
          .
        </DialogDescription>

        <label
          htmlFor={inputId}
          className="mb-1.5 block text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase"
        >
          {fieldLabel}
        </label>
        <input
          id={inputId}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={currentValue}
          aria-label={fieldLabel}
          className="w-full rounded-xl border border-line bg-field px-3.5 py-3 font-mono text-[14px] font-bold text-ink tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />

        <div className="mt-[18px] flex gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-xl border border-line px-3 py-3 text-center text-sm font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canContinue && onContinue()}
            disabled={!canContinue}
            className={cn(
              "flex-1 rounded-xl px-3 py-3 text-center text-sm font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              canContinue
                ? "bg-btn-dark text-white"
                : "cursor-not-allowed bg-line text-ink3"
            )}
          >
            Continue
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
