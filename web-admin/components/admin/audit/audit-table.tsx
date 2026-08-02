"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { AuditRow } from "@/components/admin/audit/audit-row"
import { GRID_COLS, PAGE_SIZE } from "@/constants/audit"
import type { AuditTableProps } from "@/types"

/** The audit-log table body: the 6-column header row + four async branches. */
export function AuditTable({
  items,
  isLoading,
  isError,
  isSuccess,
  onRetry,
}: AuditTableProps) {
  return (
    <>
      <div
        className={`grid ${GRID_COLS} gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
      >
        <div>Actor</div>
        <div>Action</div>
        <div>Target</div>
        <div>Before → after</div>
        <div>Reason</div>
        <div>Time</div>
      </div>

      {isLoading && (
        <div className="flex flex-col" aria-busy="true">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div
              key={i}
              className={`grid ${GRID_COLS} items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0`}
            >
              <Skeleton className="h-8 w-full rounded-[6px]" />
              <Skeleton className="h-5 w-20 rounded-[6px]" />
              <Skeleton className="h-5 w-full rounded-[6px]" />
              <Skeleton className="h-5 w-full rounded-[6px]" />
              <Skeleton className="h-5 w-full rounded-[6px]" />
              <Skeleton className="h-5 w-24 rounded-[6px]" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="px-5 py-[50px] text-center">
          <div className="text-[14px] font-bold text-tdn">
            Failed to load the audit log
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex h-[34px] items-center rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {isSuccess && items.length === 0 && (
        <div className="px-5 py-[60px] text-center text-ink3">
          <div className="text-[14px] font-bold text-ink2">
            No audit entries match these filters
          </div>
          <div className="mt-1 text-[12.5px]">
            Try widening the date range or clearing the action filter.
          </div>
        </div>
      )}

      {isSuccess &&
        items.map((entry) => <AuditRow key={entry.id} entry={entry} />)}
    </>
  )
}
