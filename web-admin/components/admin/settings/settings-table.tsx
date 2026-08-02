"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { SETTINGS_GRID } from "@/constants/settings"
import { SettingsTableRow } from "@/components/admin/settings/settings-table-row"
import type { SettingsTableProps } from "@/types"

/**
 * The settings card — the design's 5-column grid table with its own four async branches.
 * `rows` are the search-filtered rows; `totalCount` distinguishes the "no keys" empty
 * state from a "no match" one.
 */
export function SettingsTable({
  rows,
  totalCount,
  isLoading,
  isError,
  isSuccess,
  search,
  onRetry,
  onEdit,
}: SettingsTableProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <div
        className={cn(
          "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
          SETTINGS_GRID
        )}
      >
        <div>Key</div>
        <div>Effective value</div>
        <div>Source</div>
        <div>Description</div>
        <div aria-hidden="true" />
      </div>

      {isLoading && (
        <div className="divide-y divide-line2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "grid items-center gap-3 px-[18px] py-[13px]",
                SETTINGS_GRID
              )}
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16 rounded-[6px]" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="ml-auto h-8 w-16 rounded-[9px]" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="px-[18px] py-10 text-center">
          <p className="text-[14px] font-bold text-tdn">
            Failed to load settings
          </p>
          <p className="mt-1 text-[12.5px] text-ink3">
            The config registry could not be read.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {isSuccess && rows.length === 0 && (
        <div className="px-[18px] py-10 text-center">
          <p className="text-[14px] font-bold text-ink">
            {totalCount === 0 ? "No tunable keys" : "No matching keys"}
          </p>
          <p className="mt-1 text-[12.5px] text-ink3">
            {totalCount === 0
              ? "The config registry is empty."
              : `No keys match “${search.trim()}”.`}
          </p>
        </div>
      )}

      {isSuccess &&
        rows.map((row) => (
          <SettingsTableRow key={row.key} row={row} onEdit={onEdit} />
        ))}
    </div>
  )
}
