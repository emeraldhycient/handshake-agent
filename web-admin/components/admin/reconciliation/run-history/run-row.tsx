import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { formatRunDate } from "@/lib/reconciliation/run-history"
import {
  RUN_STATUS_VARIANT,
  RUN_TYPE_LABEL,
} from "@/constants/recon-run-history"
import type { ReconRunRowProps } from "@/types/components"

import { RunBreaks } from "./run-breaks"

/** One expandable run row — a status/type/counts header that reveals the run's breaks. */
export function ReconRunRow({
  run,
  expanded,
  onToggle,
  onAct,
}: ReconRunRowProps) {
  return (
    <li className="py-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Badge variant={RUN_STATUS_VARIANT[run.status]}>{run.status}</Badge>
          <span className="text-sm font-semibold text-ink">
            {RUN_TYPE_LABEL[run.runType]}
          </span>
        </span>
        <span className="flex items-center gap-4 text-xs text-ink3">
          <span>{run.totalChecked} checked</span>
          <span
            className={cn(
              "font-semibold",
              run.breaksDetected > 0 ? "text-tdn" : "text-ink3"
            )}
          >
            {run.breaksDetected} break{run.breaksDetected === 1 ? "" : "s"}
          </span>
          <span>{formatRunDate(run.startedAt)}</span>
        </span>
      </button>

      {expanded && <RunBreaks runId={run.id} onAct={onAct} />}
    </li>
  )
}
