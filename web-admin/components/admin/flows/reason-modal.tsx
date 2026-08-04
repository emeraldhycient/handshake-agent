"use client"

/**
 * ReasonModal — flow modal step 1 (design template line 1166). A blue document icon,
 * "recorded in the immutable audit log" copy, reason-category chips, a required
 * free-text reason, and Cancel / Continue. The Continue CTA activates (dark fill) only
 * once a non-empty reason is entered; empty submits are refused. Presentation only —
 * it captures the reason and hands it to `onContinue`; a real callsite chains this to
 * the next flow step (step-up / engine / maker).
 *
 * Built on the shared Dialog primitive (focus-trap + Esc close). The scrim + radius-20
 * flow panel + `hsPop` come from the design-tuned DialogOverlay/DialogContent (§5).
 */
import { useState } from "react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ReasonModalProps } from "@/types"

/** The design's five reason categories (logic.js `reasonCats`, line 401). */
const DEFAULT_CATEGORIES = [
  "Customer request",
  "Fraud / risk",
  "Ops correction",
  "Compliance",
  "Duplicate",
] as const

export function ReasonModal({
  open,
  onOpenChange,
  title,
  onContinue,
  categories = DEFAULT_CATEGORIES,
  minLength = 1,
}: ReasonModalProps) {
  const [reason, setReason] = useState("")
  const [category, setCategory] = useState("")
  const canContinue = reason.trim().length >= minLength

  function submit() {
    if (!canContinue) return
    onContinue(reason.trim(), category)
    setReason("")
    setCategory("")
  }

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
                d="M8 10h8M8 14h5M6 4h12a1 1 0 0 1 1 1v11l-4 4H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <DialogTitle>{title}</DialogTitle>
        </div>
        <DialogDescription className="mb-4 text-[13px] leading-normal text-ink2">
          This action is recorded in the immutable audit log. A reason is
          required.
        </DialogDescription>

        <div className="mb-3 flex flex-wrap gap-[7px]">
          {categories.map((c) => {
            const active = category === c
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(active ? "" : c)}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active
                    ? "border-btn-dark bg-btn-dark text-white"
                    : "border-line bg-card text-ink2 hover:bg-hov"
                )}
              >
                {c}
              </button>
            )
          })}
        </div>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Describe why you are taking this action…"
          aria-label="Reason"
          className="min-h-[92px] w-full resize-y rounded-xl border border-line bg-field px-3.5 py-3 text-[13.5px] text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
            onClick={submit}
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
