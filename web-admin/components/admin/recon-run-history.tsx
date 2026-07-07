"use client"

/**
 * ReconRunHistoryPanel (Go-readiness #3) — the DURABLE reconciliation-run history +
 * break lifecycle. Composition only: `useReconRunHistory` owns the runs read, the
 * expand state, and the acknowledge/resolve disposition (reason → step-up) state
 * machine; the list + rows + breaks live in `components/admin/reconciliation/run-history/*`.
 *
 * Each disposition is annotation-only, step-up-gated, and audited — it moves no money
 * (§3.1); over-credits are surfaced for human action, never auto-debited.
 */
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { ReasonModal } from "@/components/admin/flows"
import { ReconRunList } from "@/components/admin/reconciliation/run-history/run-list"
import { useReconRunHistory } from "@/lib/hooks/use-recon-run-history"

export function ReconRunHistoryPanel() {
  const h = useReconRunHistory()

  return (
    <div className="mt-6 rounded-2xl border border-line bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-bold text-ink">Run history</h2>
        <p className="mt-0.5 text-xs text-ink3">
          Durable reconciliation runs. Expand a run to triage its detected
          breaks — acknowledge or resolve (annotation-only, step-up-gated; never
          a debit).
        </p>
      </div>

      <ReconRunList
        isPending={h.runsQuery.isPending}
        isError={h.runsQuery.isError}
        isSuccess={h.runsQuery.isSuccess}
        runs={h.runsQuery.data?.items ?? []}
        expandedId={h.expanded}
        onToggle={h.toggleRun}
        onAct={h.openReason}
      />

      <ReasonModal
        open={h.reasonOpen}
        onOpenChange={(o) => !o && h.setReasonOpen(false)}
        title={h.reasonTitle}
        onContinue={(r, category) =>
          h.runDisposition(category ? `${category}: ${r}` : r)
        }
      />

      <StepUpDialog
        open={h.stepUp.open}
        mfaEnabled={h.me.data?.mfaEnabled ?? false}
        onOpenChange={h.stepUp.setOpen}
        onSuccess={h.onStepUpSuccess}
      />

      {h.localError && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
          {h.localError}
        </p>
      )}
    </div>
  )
}
