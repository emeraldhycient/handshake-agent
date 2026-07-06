"use client"

/**
 * ReconciliationPage — provider-vs-ledger reconciliation (design §6.12 `Recon.html`).
 * Orchestrator: pulls the funds-safety state machine from `useReconDispositions` and
 * composes the cron status bar, the break board, the durable run history, the shared
 * flow modals, and the step-up dialog. Funds-safety invariant (root §3.1): over-credits
 * are flagged for human action, NEVER auto-debited — resolution is engine-brokered, and
 * this surface only proposes; it never issues a raw ledger debit.
 */
import { useRouter } from "next/navigation"

import { useReconDispositions } from "@/lib/hooks/use-recon-dispositions"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { ReconRunHistoryPanel } from "@/components/admin/recon-run-history"
import { ReasonModal } from "@/components/admin/flows"
import { ReconStatusBar } from "@/components/admin/reconciliation/recon-status-bar"
import { ReconBreakList } from "@/components/admin/reconciliation/recon-break-list"
import { ReconBreakFlows } from "@/components/admin/reconciliation/recon-break-flows"

export function ReconciliationPage() {
  const router = useRouter()
  const r = useReconDispositions()

  return (
    <div
      data-screen-label="Reconciliation"
      className="mx-auto max-w-[1120px] px-[30px] pt-[26px] pb-[60px]"
    >
      <div className="mb-4">
        <h1 className="m-0 text-2xl font-extrabold tracking-[-0.02em]">
          Reconciliation
        </h1>
        <p className="mt-[5px] mb-0 text-[13.5px] text-ink2">
          Provider-vs-ledger breaks. Over-credits are flagged for human action —
          never auto-debited.
        </p>
      </div>

      <ReconStatusBar
        status={r.statusQuery.data}
        isLoading={r.statusQuery.isLoading}
        isError={r.statusQuery.isError}
        openCount={r.openCount}
        onRunNow={() => r.setRunReasonOpen(true)}
      />

      <ReconBreakList
        breaks={r.breaks}
        isLoading={r.breaksQuery.isLoading}
        isError={r.breaksQuery.isError}
        onRetry={() => void r.breaksQuery.refetch()}
        onOpenTx={(id) => router.push(`/transactions/${id}`)}
        onEscalate={r.openEscalate}
        onAccept={r.openAccept}
        onResolve={r.openResolve}
      />

      {/* Durable reconciliation-run history + persisted-break lifecycle (Go-readiness #3). */}
      <ReconRunHistoryPanel />

      {r.activeBreak && r.active && (
        <ReconBreakFlows
          activeBreak={r.activeBreak}
          flow={r.active.flow}
          reason={r.reason}
          onClose={r.closeFlow}
          onAdvance={r.advanceFlow}
          onCaptureReason={r.captureReason}
          onDisposition={r.runDisposition}
        />
      )}

      {/* "Run now" reason (audit) leg → the REAL settlement-reconciliation run (step-up-gated). */}
      <ReasonModal
        open={r.runReasonOpen}
        onOpenChange={(o) => !o && r.setRunReasonOpen(false)}
        title="Run reconciliation now"
        onContinue={(reason, category) =>
          r.triggerRun(category ? `${category}: ${reason}` : reason)
        }
      />

      {/* Real step-up: opened when a disposition OR a "Run now" mutation 403s; replays on re-auth. */}
      <StepUpDialog
        open={r.stepUp.open}
        mfaEnabled={r.me.data?.mfaEnabled ?? false}
        onOpenChange={r.stepUp.setOpen}
        onSuccess={r.onStepUpSuccess}
      />
      {r.localError && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
          {r.localError}
        </p>
      )}
    </div>
  )
}
