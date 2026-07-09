"use client"

import { ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import type { SanctionsFlowModalsProps } from "@/types/components"

/**
 * The shared disposition flow modals (SPEC §5): Clear / Escalate / Block each open a
 * ReasonModal (a disposition applies as soon as the reason is confirmed — no change
 * request is raised) and thread the typed reason as the audited `comment` (A7 — the
 * Escalate flow no longer sends a comment-less disposition). Block/Escalate/Clear are
 * sensitive — the server demands step-up. Each submit fires the disposition mutation;
 * the REAL step-up is server-driven: a 403 opens the StepUpDialog and the POST replays
 * on re-auth. Presentational — the mutation lives in `useSanctionsDispositions`; the
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

      {/* Escalate → ReasonModal (reason recorded as the audited disposition comment). */}
      <ReasonModal
        open={flow?.kind === "escalate"}
        onOpenChange={close}
        title={
          flow?.kind === "escalate"
            ? `Escalate screening match — ${labelOf(flow.matchId)}`
            : "Escalate screening match"
        }
        onContinue={(reason) =>
          flow?.kind === "escalate" &&
          onDisposition(flow.matchId, "escalated", reason)
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
