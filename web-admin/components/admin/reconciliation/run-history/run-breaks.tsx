import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDelta } from "@/lib/format"
import { useReconRun } from "@/lib/query/hooks"
import { isActionable } from "@/lib/reconciliation/run-history"
import {
  BREAK_STATUS_VARIANT,
  BREAK_TYPE_LABEL,
} from "@/constants/recon-run-history"
import type { RunBreaksProps } from "@/types/components"

/** The detected breaks for one expanded run (lazily fetched on expand). */
export function RunBreaks({ runId, onAct }: RunBreaksProps) {
  const detail = useReconRun(runId)

  if (detail.isPending) {
    return (
      <Skeleton className="mt-3 h-10 w-full" data-testid="run-breaks-loading" />
    )
  }
  if (detail.isError) {
    return (
      <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
        Couldn’t load this run’s breaks.
      </p>
    )
  }
  if (detail.data.breaks.length === 0) {
    return (
      <p className="mt-3 text-xs text-ink3">No breaks detected in this run.</p>
    )
  }

  return (
    <ul className="mt-3 space-y-2 border-l-2 border-line pl-3">
      {detail.data.breaks.map((brk) => (
        <li
          key={brk.id}
          className="flex items-center justify-between gap-3 rounded-lg bg-card2 px-3 py-2"
        >
          <span className="flex items-center gap-2">
            <Badge variant={BREAK_STATUS_VARIANT[brk.status]}>
              {brk.status}
            </Badge>
            <span className="text-xs font-semibold text-ink">
              {BREAK_TYPE_LABEL[brk.breakType]}
            </span>
            <span className="font-mono text-xs text-ink3">
              {formatDelta(brk.delta, brk.currency)}
            </span>
          </span>
          {isActionable(brk.status) && (
            <span className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAct(brk.id, "acknowledge")}
              >
                Acknowledge
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => onAct(brk.id, "resolve")}
              >
                Resolve
              </Button>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
