"use client"

import { EngineActionModal, ReasonModal } from "@/components/admin/flows"
import { NO_LEDGER } from "@/constants/ops"
import { jobEffect } from "@/lib/ops/format"
import type { OpsRunFlowProps } from "@/types"

/**
 * The "Run now" flow modals for the active job: reason (audit) → engine-action → the
 * REAL run mutation (step-up-gated by the page's `StepUpDialog`). A manual job run is
 * engine-brokered oversight — no ledger entries, no money (§3.1). Presentational: it
 * maps the stage onto a modal; the mutation lives in `useOpsRun`.
 */
export function OpsRunFlow({
  job,
  stage,
  onClose,
  onContinue,
  onExecute,
}: OpsRunFlowProps) {
  const close = (open: boolean) => !open && onClose()
  return (
    <>
      <ReasonModal
        open={stage === "reason"}
        onOpenChange={close}
        title={`Run ${job.name} now`}
        onContinue={(r, category) =>
          onContinue(category ? `${category}: ${r}` : r)
        }
      />
      <EngineActionModal
        open={stage === "engine"}
        onOpenChange={close}
        title={`Run ${job.name}`}
        effect={jobEffect(job)}
        ledger={[...NO_LEDGER]}
        idempotencyKey={`ops-run-${job.id}`}
        cta="Trigger via engine"
        onExecute={onExecute}
      />
    </>
  )
}
