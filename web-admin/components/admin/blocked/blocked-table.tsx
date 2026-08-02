"use client"

import { BLOCKED_GRID } from "@/constants/blocked"
import { BlockedRow, LoadingRows } from "@/components/admin/blocked/blocked-row"
import type { BlockedTableProps } from "@/types"

/** The deny-list table card: column header + loading / error / empty / data branches. */
export function BlockedTable({
  entries,
  isLoading,
  isError,
  isSuccess,
  onRetry,
  onUnblock,
}: BlockedTableProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <div
        className={`grid ${BLOCKED_GRID} gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
      >
        <div>Kind</div>
        <div>Value</div>
        <div>Reason</div>
        <div>Added</div>
        <div aria-hidden="true" />
      </div>

      {isLoading && <LoadingRows />}

      {isError && (
        <div className="px-[18px] py-10 text-center">
          <p className="text-[13px] font-bold text-tdn">
            Failed to load the blocked list
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 cursor-pointer rounded-[9px] border border-line bg-card px-[14px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {isSuccess && entries.length === 0 && (
        <div className="px-[18px] py-10 text-center text-[12.5px] text-ink3">
          Nothing blocked. No users, addresses or banks are on the list.
        </div>
      )}

      {isSuccess &&
        entries.map((entry) => (
          <BlockedRow
            key={entry.id}
            entry={entry}
            onUnblock={() => onUnblock(entry)}
          />
        ))}
    </div>
  )
}
