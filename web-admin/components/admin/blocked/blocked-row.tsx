"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { BLOCKED_GRID, KIND_LABEL } from "@/constants/blocked"
import { shortDate } from "@/lib/blocked/format"
import type { BlockedRowProps } from "@/types/components"

/** Loading placeholder for the deny-list rows (matches the row silhouette). */
export function LoadingRows() {
  return (
    <div className="flex flex-col gap-0" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="border-b border-line2 px-[18px] py-[13px] last:border-b-0"
        >
          <Skeleton className="h-5 w-full" />
        </div>
      ))}
    </div>
  )
}

/**
 * One deny-list row. An active entry offers the Unblock action; a superseded entry
 * (append-only history, §3.4) renders dimmed with a "Superseded" marker and no action —
 * nothing is ever deleted.
 */
export function BlockedRow({ entry, onUnblock }: BlockedRowProps) {
  const superseded = entry.supersededAt !== null

  return (
    <div
      className={`grid ${BLOCKED_GRID} items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0 ${
        superseded ? "opacity-55" : ""
      }`}
    >
      <div>
        <span className="rounded-[6px] bg-card2 px-2 py-[2px] text-[10.5px] font-bold text-ink2">
          {KIND_LABEL[entry.kind]}
        </span>
      </div>

      <div
        className="truncate font-mono text-[12px] font-semibold text-ink"
        title={entry.value}
      >
        {entry.value}
      </div>

      <div className="text-[12px] text-ink2">{entry.reason}</div>

      <div className="text-[11.5px] text-ink3">
        {shortDate(entry.createdAt)}
      </div>

      <div className="text-right">
        {superseded ? (
          <span className="text-[11px] font-bold text-ink3">Superseded</span>
        ) : (
          <button
            type="button"
            onClick={onUnblock}
            aria-label={`Unblock ${entry.value}`}
            className="inline-flex text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Unblock
          </button>
        )}
      </div>
    </div>
  )
}
