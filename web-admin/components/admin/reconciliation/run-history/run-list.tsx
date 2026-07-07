import { Skeleton } from "@/components/ui/skeleton"
import type { ReconRunListProps } from "@/types/components"

import { ReconRunRow } from "./run-row"

/**
 * The durable run-history list — the four async branches (loading skeletons / error /
 * empty / the expandable run rows) over the persisted reconciliation runs read.
 */
export function ReconRunList({
  isPending,
  isError,
  isSuccess,
  runs,
  expandedId,
  onToggle,
  onAct,
}: ReconRunListProps) {
  if (isPending) {
    return (
      <div className="space-y-2" data-testid="recon-runs-loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <p role="alert" className="text-[12px] font-semibold text-tdn">
        Couldn’t load run history. Try again.
      </p>
    )
  }

  if (!isSuccess) return null

  if (runs.length === 0) {
    return (
      <p className="text-xs text-ink3">No reconciliation runs recorded yet.</p>
    )
  }

  return (
    <ul className="divide-y divide-line">
      {runs.map((run) => (
        <ReconRunRow
          key={run.id}
          run={run}
          expanded={expandedId === run.id}
          onToggle={() => onToggle(run.id)}
          onAct={onAct}
        />
      ))}
    </ul>
  )
}
