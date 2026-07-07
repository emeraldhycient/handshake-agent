"use client"

import { cn } from "@/lib/utils"
import {
  KIND_META,
  OPEN_CARD_LINE,
  SEVERITY_META,
} from "@/constants/reconciliation"
import { deltaTone, formatDelta } from "@/lib/reconciliation/format"
import type { ReconBreakCardProps } from "@/types/components"

/**
 * One reconciliation break card: icon tile + kind label + severity pill + tx link +
 * signed delta. While OPEN it shows the funds-safety note + three actions (Escalate /
 * Accept / Resolve via engine); once dispositioned it shows the outcome footer. This
 * card only surfaces actions — the disposition itself is engine-brokered (§3.1).
 */
export function ReconBreakCard({
  item,
  onOpenTx,
  onEscalate,
  onAccept,
  onResolve,
}: ReconBreakCardProps) {
  const meta = KIND_META[item.kind]
  const sev = SEVERITY_META[item.severity]
  const isOpen = item.localResolution === undefined

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card px-5 py-4",
        isOpen ? OPEN_CARD_LINE[item.severity] : "border-line"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 flex-none items-center justify-center rounded-[10px]",
            meta.tile,
            meta.fg
          )}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d={meta.path}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[9px]">
            <span className="text-sm font-bold">{meta.label}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase",
                sev.bg,
                sev.fg
              )}
            >
              {sev.label}
            </span>
            <button
              type="button"
              onClick={() => onOpenTx(item.transactionId)}
              className="font-mono text-[11px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {item.transactionId}
            </button>
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.45] text-ink2">
            {item.detail}
          </div>
        </div>
        <div className="flex-none text-right">
          <div className="text-[10px] font-bold text-ink3 uppercase">Delta</div>
          <div
            className={cn(
              "font-mono text-sm font-extrabold tabular-nums",
              deltaTone(item.kind)
            )}
          >
            {formatDelta(item)}
          </div>
        </div>
      </div>

      {isOpen ? (
        <div className="mt-3.5 flex items-center gap-[9px] border-t border-line2 pt-3.5">
          <div className="flex flex-1 items-center gap-1.5 text-[11px] text-ink3">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 8v5M12 16h.01M12 3l9 16H3z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Resolution is engine-brokered · never a raw debit.
          </div>
          <button
            type="button"
            onClick={() => onEscalate(item.id)}
            className="rounded-[9px] border border-line px-3.5 py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Escalate to case
          </button>
          <button
            type="button"
            onClick={() => onAccept(item.id)}
            className="rounded-[9px] border border-line px-3.5 py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => onResolve(item.id)}
            className="rounded-[9px] bg-brand-green px-4 py-2 text-xs font-extrabold text-white transition-colors hover:bg-brand-green/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Resolve via engine
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-[7px] text-xs font-bold text-tok">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="m5 12 5 5L20 7"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {item.localResolution === "escalated"
            ? "Escalated to case"
            : item.localResolution === "accepted"
              ? "Accepted (no debit)"
              : "Resolved"}
        </div>
      )}
    </div>
  )
}
