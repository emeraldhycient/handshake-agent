"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { formatRunTime } from "@/lib/reconciliation/format"
import type { ReconStatusBarProps } from "@/types/components"

/** The reconciliation-cron status bar — last/next run + open-breaks count + Run now. */
export function ReconStatusBar({
  status,
  isLoading,
  isError,
  openCount,
  onRunNow,
}: ReconStatusBarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-[14px] rounded-[14px] border border-line bg-card px-[18px] py-[14px]">
      <div className="flex items-center gap-[9px]">
        <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-sok text-tok">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div>
          <div className="text-[12.5px] font-bold">Reconciliation cron</div>
          {isError ? (
            <div className="text-[11px] text-tdn">
              Failed to load reconciliation status
            </div>
          ) : isLoading ? (
            <Skeleton className="mt-1 h-3 w-56 rounded" />
          ) : (
            <div className="text-[11px] text-ink3">
              Last run {formatRunTime(status?.lastRunAt ?? null)} · next{" "}
              {formatRunTime(status?.nextRunAt ?? null)} ·{" "}
              <span className="tabular-nums">{openCount}</span> open breaks
              {status?.enabled === false ? " · paused" : ""}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onRunNow}
        className="flex h-9 items-center gap-[7px] rounded-[10px] border border-line bg-card px-[15px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 4l14 8-14 8z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        Run now
      </button>
    </div>
  )
}
