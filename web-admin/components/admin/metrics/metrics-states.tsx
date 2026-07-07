import { Skeleton } from "@/components/ui/skeleton"
import type { MetricsErrorProps } from "@/types/components"

/** Loading branch — the KPI grid + two-column body as pulsing skeletons. */
export function MetricsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-[92px] rounded-2xl" />
        <Skeleton className="h-[92px] rounded-2xl" />
        <Skeleton className="h-[92px] rounded-2xl" />
        <Skeleton className="h-[92px] rounded-2xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Skeleton className="h-64 rounded-[18px]" />
        <Skeleton className="h-64 rounded-[18px]" />
      </div>
    </div>
  )
}

/**
 * Error branch — a real failure, or (when `gracefulOnForbidden` and the failure is a
 * 403) a friendly "no metrics access" note used on the ungated home page (§3.3 UX).
 */
export function MetricsError({
  gracefulOnForbidden,
  isForbidden,
}: MetricsErrorProps) {
  if (gracefulOnForbidden && isForbidden) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <div className="max-w-md rounded-[18px] border border-swn bg-swn/40 p-6 text-center">
          <p className="text-sm font-bold text-twn">No metrics access</p>
          <p className="mt-1 text-[12.5px] text-ink2">
            Your role can&apos;t view the operational dashboard. Ask a super
            admin to grant the Metrics permission.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-[18px] border border-sdn bg-sdn/40 p-6 text-center">
      <p className="text-sm font-bold text-tdn">Failed to load metrics</p>
      <p className="mt-1 text-[12.5px] text-ink2">Please refresh the page.</p>
    </div>
  )
}
