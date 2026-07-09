"use client"

import { MakerCheckerModal, ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import type { SanctionsFlowModalsProps } from "@/types/components"

/**
 * The shared disposition flow modals (SPEC §5): Clear → ReasonModal (audited);
 * Escalate → MakerCheckerModal in its honest IMMEDIATE mode (a disposition applies
 * as soon as it is confirmed — no change request is raised); Block → ReasonModal
 * (sensitive — the server demands step-up). Each submit fires the disposition
 * mutation with the typed reason threaded as `comment`; the REAL step-up is
 * server-driven: a 403 opens the StepUpDialog and the POST replays on re-auth.
 * Presentational — the mutation lives in `useSanctionsDispositions`; the
 * disposition annotates, it never moves money (§3.1).
 */
export function SanctionsFlowModals({
  flow,
  labelOf,
  onClose,
  onDisposition,
  mfaEnabled,
  stepUpOpen,
  onStepUpOpenChange,
  onStepUpSuccess,
}: SanctionsFlowModalsProps) {
  const close = (open: boolean) => !open && onClose()

  return (
    <>
      {/* Clear → ReasonModal (reason recorded as the audited disposition comment). */}
      <ReasonModal
        open={flow?.kind === "clear"}
        onOpenChange={close}
        title={
          flow?.kind === "clear"
            ? `Clear screening match — ${labelOf(flow.matchId)}`
            : "Clear screening match"
        }
        onContinue={(reason) =>
          flow?.kind === "clear" &&
          onDisposition(flow.matchId, "cleared", reason)
        }
      />

      {/* Escalate → honest immediate confirm (no approval queue exists here). */}
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

      {/* Block → ReasonModal (reason → audited comment; server enforces step-up). */}
      <ReasonModal
        open={flow?.kind === "block"}
        onOpenChange={close}
        title={
          flow?.kind === "block"
            ? `Block — ${labelOf(flow.matchId)}`
            : "Block match"
        }
        onContinue={(reason) =>
          flow?.kind === "block" &&
          onDisposition(flow.matchId, "blocked", reason)
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
