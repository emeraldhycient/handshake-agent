"use client"

import { GRID_COLS } from "@/constants/audit"
import { actionChip, displayValue, formatTime } from "@/lib/audit/format"
import type { AuditRowProps } from "@/types"

/** One rendered audit row (design body row markup — preserved 1:1). */
export function AuditRow({ entry }: AuditRowProps) {
  return (
    <div
      className={`grid ${GRID_COLS} items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0`}
    >
      {/* Actor + resolved role (subtle em dash when the role is null). */}
      <div className="min-w-0">
        <div
          className="truncate text-[12.5px] font-bold text-ink"
          title={entry.actor}
        >
          {entry.actor}
        </div>
        <div className="truncate text-[10.5px] text-ink3">
          {entry.actorRole ?? "—"}
        </div>
      </div>
      {/* Action chip */}
      <div>
        <span
          className={`inline-flex rounded-[6px] px-2 py-0.5 font-mono text-[11px] font-bold ${actionChip(entry.action)}`}
        >
          {entry.action}
        </span>
      </div>
      {/* Target (contract `subject`) */}
      <div
        className="truncate font-mono text-[11.5px] text-ink2"
        title={entry.subject}
      >
        {entry.subject}
      </div>
      {/* Before → after */}
      <div className="text-[11.5px]">
        <span className="font-mono text-tdn line-through opacity-75">
          {displayValue(entry.before)}
        </span>{" "}
        <span className="font-mono font-bold text-tok">
          → {displayValue(entry.after)}
        </span>
      </div>
      {/* Reason (first-class `reason`, projected server-side; em dash if null) */}
      <div className="text-[11.5px] text-ink2">{entry.reason ?? "—"}</div>
      {/* Time */}
      <div className="font-mono text-[11px] text-ink3 tabular-nums">
        {formatTime(entry.createdAt)}
      </div>
    </div>
  )
}
