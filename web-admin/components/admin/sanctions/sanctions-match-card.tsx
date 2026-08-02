"use client"

import { cn } from "@/lib/utils"
import { DONE_META, VERDICT_META } from "@/constants/sanctions"
import type { SanctionsMatchCardProps } from "@/types"

/** The red-triangle danger mark (design line 8 icon tile). */
function TriangleMark({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 flex-none items-center justify-center rounded-[11px]",
        open ? "bg-sdn text-tdn" : "bg-card2 text-ink3"
      )}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 4l9 16H3zM12 10v4M12 17h.01"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/** A ghost disposition button (Clear / Escalate) — design line 11. */
function GhostAction({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[9px] border border-line px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {label}
    </button>
  )
}

/**
 * One screening record rendered as the design's match card (design lines 6–14). Open
 * matches offer Clear / Escalate / Block; dispositioned matches show a done-label.
 */
export function SanctionsMatchCard({
  record,
  done,
  onClear,
  onEscalate,
  onBlock,
}: SanctionsMatchCardProps) {
  const open = done === null
  const verdict = VERDICT_META[record.verdict]
  const flagged = open && verdict.danger

  return (
    <div
      className={cn(
        "rounded-[16px] border bg-card px-5 py-4",
        flagged ? "border-sdn" : "border-line"
      )}
    >
      <div className="flex items-center gap-[13px]">
        <TriangleMark open={flagged} />

        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-bold text-ink">
            {record.counterpartyId}
          </div>
          <div className="text-[11.5px] text-ink2">
            <b className="font-bold">{record.matchedList}</b> ·{" "}
            {record.matchType}
          </div>
        </div>

        {/* Score slot (design line 10): the numeric 0–100 confidence + verdict label. */}
        <div className="mr-1.5 flex-none text-center">
          <div className="text-[10px] font-bold tracking-[0.04em] text-ink3 uppercase">
            Score
          </div>
          <div
            className={cn(
              "text-sm font-extrabold",
              open ? verdict.fg : "text-ink3"
            )}
          >
            {record.matchScore}
          </div>
          <div className="text-[10px] font-bold text-ink3">{verdict.label}</div>
        </div>

        {open ? (
          <div className="flex gap-2">
            <GhostAction label="Clear" onClick={onClear} />
            <GhostAction label="Escalate" onClick={onEscalate} />
            <button
              type="button"
              onClick={onBlock}
              className="cursor-pointer rounded-[9px] bg-tdn px-[15px] py-2 text-xs font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Block
            </button>
          </div>
        ) : (
          <span
            className={cn("text-[11.5px] font-bold", DONE_META[done].className)}
          >
            {DONE_META[done].label}
          </span>
        )}
      </div>
    </div>
  )
}
