"use client"

import {
  EngineActionModal,
  MakerCheckerModal,
  ReasonModal,
} from "@/components/admin/flows"
import { KIND_META } from "@/constants/reconciliation"
import {
  acceptDiff,
  engineEffect,
  engineLedger,
} from "@/lib/reconciliation/format"
import type { ReconBreakFlowsProps } from "@/types/components"

/** Prefix the audited reason with the selected category, when one was chosen. */
function withCategory(reason: string, category?: string): string {
  return category ? `${category}: ${reason}` : reason
}

/**
 * The shared flow modals for the active break (design §6.12):
 *   Escalate → reason (audit) → the REAL escalate mutation (opens a case, no debit).
 *   Accept   → reason → maker-checker → the REAL accept mutation (no-debit disposition).
 *   Resolve  → reason → engine-action → the REAL resolve mutation (re-drives settlement
 *   via the engine — never a raw debit). The disposition mutations are step-up-gated by
 *   the page's `StepUpDialog`. Presentational: it maps the flow stage onto a modal and
 *   relays each leg's outcome; the mutations themselves live in `useReconDispositions`.
 */
export function ReconBreakFlows({
  activeBreak,
  flow,
  reason,
  onClose,
  onAdvance,
  onCaptureReason,
  onDisposition,
}: ReconBreakFlowsProps) {
  const close = (open: boolean) => !open && onClose()

  return (
    <>
      {/* Escalate: reason (audit) → the REAL escalate mutation. */}
      <ReasonModal
        open={flow.kind === "escalate"}
        onOpenChange={close}
        title={`Escalate ${activeBreak.transactionId} to case`}
        onContinue={(r, category) =>
          onDisposition(activeBreak.id, "escalated", withCategory(r, category))
        }
      />

      {/* Accept: reason (audit) → maker-checker confirm → the REAL accept mutation. */}
      <ReasonModal
        open={flow.kind === "accept" && flow.stage === "reason"}
        onOpenChange={close}
        title={`Accept break ${activeBreak.transactionId}`}
        onContinue={(r, category) => {
          onCaptureReason(withCategory(r, category))
          onAdvance({ kind: "accept", stage: "confirm" })
        }}
      />
      <MakerCheckerModal
        open={flow.kind === "accept" && flow.stage === "confirm"}
        onOpenChange={close}
        title={`Accept break ${activeBreak.transactionId}`}
        diff={acceptDiff(activeBreak)}
        onSubmit={() => onDisposition(activeBreak.id, "accepted", reason)}
      />

      {/* Resolve via engine: reason (audit) → engine-action → the REAL resolve mutation. */}
      <ReasonModal
        open={flow.kind === "resolve" && flow.stage === "reason"}
        onOpenChange={close}
        title={`Resolve ${activeBreak.transactionId} via engine`}
        onContinue={(r, category) => {
          onCaptureReason(withCategory(r, category))
          onAdvance({ kind: "resolve", stage: "engine" })
        }}
      />
      <EngineActionModal
        open={flow.kind === "resolve" && flow.stage === "engine"}
        onOpenChange={close}
        title={`Resolve ${KIND_META[activeBreak.kind].label.toLowerCase()}`}
        effect={engineEffect(activeBreak)}
        ledger={engineLedger(activeBreak)}
        idempotencyKey={`recon-${activeBreak.id}-resolve`}
        cta="Resolve via engine"
        onExecute={() => onDisposition(activeBreak.id, "resolved", reason)}
      />
    </>
  )
}
