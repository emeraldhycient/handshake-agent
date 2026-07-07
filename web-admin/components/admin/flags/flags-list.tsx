import { Skeleton } from "@/components/ui/skeleton"
import type { FlagsListProps } from "@/types/components"

import { FlagRow } from "./flag-row"

/**
 * The flag list region — the three async branches (loading skeletons / error+retry /
 * the resolved flag rows). There is no empty branch: the flag set is a fixed registry.
 */
export function FlagsList({
  isLoading,
  isError,
  isSuccess,
  rows,
  onToggle,
  onRetry,
}: FlagsListProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-[16px]" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-[16px] border border-sdn bg-sdn/40 p-6 text-center">
        <p className="text-sm font-bold text-tdn">Failed to load flags</p>
        <p className="mt-1 text-[12.5px] text-ink2">
          The feature-flag registry could not be read.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!isSuccess) return null

  return (
    <div className="flex flex-col gap-3">
      {rows.map((flag) => (
        <FlagRow key={flag.key} flag={flag} onToggle={onToggle} />
      ))}
    </div>
  )
}
