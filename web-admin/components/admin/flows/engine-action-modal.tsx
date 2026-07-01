"use client"

/**
 * EngineActionModal — flow modal engine-execute step (design template line 1198). A
 * green "executed by the settlement engine" banner, an itemized-effect table, a
 * ledger-entries-to-be-written table, a dashed idempotency-key box (copyable), and
 * Cancel / amber execute CTA. It encodes the funds-safety invariant directly into the
 * UI: an admin money action runs the same validation + double-entry + idempotency path
 * as user-initiated movement (§3.1). Presentation only — `onExecute` hands off to the
 * caller's real engine-brokered mutation.
 *
 * Built on the shared Dialog primitive (focus-trap + Esc close), 520px flow panel.
 */
import { useState } from "react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { EngineActionModalProps } from "@/types/components"

export function EngineActionModal({
  open,
  onOpenChange,
  title,
  effect,
  ledger,
  idempotencyKey,
  cta = "Execute via engine",
  onExecute,
}: EngineActionModalProps) {
  const [copied, setCopied] = useState(false)

  async function copyIdem() {
    try {
      await navigator.clipboard?.writeText(idempotencyKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard unavailable (insecure context / denied) — the key is visible.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[520px] max-w-[94vw] gap-0 p-6"
      >
        <div className="mb-1 flex items-center gap-[11px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-sok text-tok">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 3v3M12 18v3M5 12H2M22 12h-3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <circle
                cx="12"
                cy="12"
                r="3.4"
                stroke="currentColor"
                strokeWidth="1.7"
              />
            </svg>
          </span>
          <DialogTitle>{title}</DialogTitle>
        </div>

        <div className="my-3 mb-4 flex items-start gap-[9px] rounded-xl bg-sok px-3.5 py-[11px]">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="mt-px flex-none text-tok"
          >
            <path
              d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-xs leading-snug font-semibold text-tok">
            Executed by the settlement engine — not a direct balance edit. Runs
            the same validation, double-entry ledger, and idempotency path as
            user-initiated money movement.
          </p>
        </div>

        <div className="mb-[7px] text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
          Itemized effect
        </div>
        <div className="mb-3.5 overflow-hidden rounded-xl border border-line">
          {effect.map((e) => (
            <div
              key={e.k}
              className="flex justify-between gap-3 border-b border-line2 px-3.5 py-2.5 text-[12.5px] last:border-b-0"
            >
              <span className="text-ink2">{e.k}</span>
              <span className="font-mono font-bold tabular-nums">{e.v}</span>
            </div>
          ))}
        </div>

        <div className="mb-[7px] text-[11px] font-bold tracking-[0.05em] text-ink3 uppercase">
          Ledger entries to be written
        </div>
        <div className="mb-3.5 overflow-hidden rounded-xl border border-line">
          {ledger.map((l, i) => (
            <div
              key={`${l.acct}-${i}`}
              className="grid grid-cols-[1.4fr_0.7fr_1fr] gap-2 border-b border-line2 px-3.5 py-[9px] text-[12px] last:border-b-0"
            >
              <span className="font-mono text-ink2">{l.acct}</span>
              <span
                className={cn(
                  "font-bold",
                  l.dir === "DR" ? "text-tdn" : "text-tok"
                )}
              >
                {l.dir}
              </span>
              <span className="text-right font-mono font-bold tabular-nums">
                {l.amt}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2.5 rounded-xl border border-dashed border-line bg-field px-3.5 py-[11px]">
          <div>
            <div className="text-[10.5px] font-bold tracking-[0.05em] text-ink3 uppercase">
              Idempotency key
            </div>
            <div className="mt-0.5 font-mono text-[12.5px] font-semibold">
              {idempotencyKey}
            </div>
          </div>
          <button
            type="button"
            onClick={copyIdem}
            className="text-[11.5px] font-bold text-tif transition-colors hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

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
            onClick={onExecute}
            className="flex-[1.3] rounded-xl bg-brand-amber px-3 py-3 text-center text-sm font-extrabold text-[--ink-on-amber] transition-colors hover:bg-brand-amber/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {cta}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
