"use client"

import {
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import type { SanctionsFlowModalsProps } from "@/types/components"

/**
 * The shared disposition flow modals (design's `runFlow`, SPEC §5): Clear → ReasonModal
 * (audited); Escalate → MakerCheckerModal (dual-control); Block → ReasonModal → StepUpModal
 * (sensitive, step-up-gated). Each submit fires the disposition mutation; the server-side
 * StepUpDialog replays a 403'd POST on re-auth. Presentational — the mutation lives in the
 * `useSanctionsDispositions` hook; the disposition annotates, it never moves money (§3.1).
 */
export function SanctionsFlowModals({
  flow,
  labelOf,
  onClose,
  onDisposition,
  onAdvanceBlock,
  mfaEnabled,
  stepUpOpen,
  onStepUpOpenChange,
  onStepUpSuccess,
}: SanctionsFlowModalsProps) {
  const close = (open: boolean) => !open && onClose()

  return (
    <>
      {/* Clear → ReasonModal (recorded in the immutable audit log). */}
      <ReasonModal
        open={flow?.kind === "clear"}
        onOpenChange={close}
        title={
          flow?.kind === "clear"
            ? `Clear screening match — ${labelOf(flow.matchId)}`
            : "Clear screening match"
        }
        onContinue={() =>
          flow?.kind === "clear" && onDisposition(flow.matchId, "cleared")
        }
      />

      {/* Escalate → MakerCheckerModal (enters Pending approval). */}
      <MakerCheckerModal
        open={flow?.kind === "escalate"}
        onOpenChange={close}
        title={
          flow?.kind === "escalate"
            ? `Escalate screening match — ${labelOf(flow.matchId)}`
            : "Escalate screening match"
        }
        diff={[
          {
            field: "Screening disposition",
            from: "Open match",
            to: "Escalated for review",
          },
        ]}
        onSubmit={() =>
          flow?.kind === "escalate" && onDisposition(flow.matchId, "escalated")
        }
      />

      {/* Block → ReasonModal → StepUpModal (sensitive, step-up-gated). */}
      <ReasonModal
        open={flow?.kind === "block" && flow.step === "reason"}
        onOpenChange={close}
        title={
          flow?.kind === "block"
            ? `Block — ${labelOf(flow.matchId)}`
            : "Block match"
        }
        onContinue={() =>
          flow?.kind === "block" && onAdvanceBlock(flow.matchId)
        }
      />
      <StepUpModal
        open={flow?.kind === "block" && flow.step === "stepup"}
        onOpenChange={close}
        title={
          flow?.kind === "block"
            ? `Block — ${labelOf(flow.matchId)}`
            : "Block match"
        }
        onComplete={() =>
          flow?.kind === "block" && onDisposition(flow.matchId, "blocked")
        }
      />

      {/* Server-side step-up re-auth: a 403 on the disposition POST opens this. */}
      <StepUpDialog
        open={stepUpOpen}
        mfaEnabled={mfaEnabled}
        onOpenChange={onStepUpOpenChange}
        onSuccess={onStepUpSuccess}
      />
    </>
  )
}
