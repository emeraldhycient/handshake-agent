"use client"

/**
 * TreasuryAlertAcknowledge — acknowledges a treasury threshold-breach alert.
 *
 * The acknowledgement is audited, so we capture a reason (the audited `note`) via
 * the shared ReasonModal, then run `useAcknowledgeAlert`. The action is sensitive:
 * if the mutation 403s with ADMIN_STEP_UP_REQUIRED we open the StepUpDialog and
 * replay after re-auth (`useStepUpRetry`). On success the alerts query is
 * invalidated inside the hook, so the banner re-resolves. Nothing here moves money
 * (§3.1) — this only annotates + clears an alert.
 */
import { useState } from "react"

import { ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAcknowledgeAlert, useAdminMe } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { TreasuryAlertAcknowledgeProps } from "@/types"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function TreasuryAlertAcknowledge({
  alert,
}: TreasuryAlertAcknowledgeProps) {
  const me = useAdminMe()
  const acknowledge = useAcknowledgeAlert()
  const stepUp = useStepUpRetry()
  const [reasonOpen, setReasonOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // The reason from the modal is submitted as the audited `note`. Its category is
  // captured for the audit trail but the request DTO carries only the free-text note.
  async function onReason(reason: string, category: string) {
    setReasonOpen(false)
    setLocalError(null)
    const note = category ? `${category}: ${reason}` : reason
    try {
      await stepUp.run(() =>
        acknowledge
          .mutateAsync({ id: alert.id, input: { note } })
          .then(() => undefined)
      )
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setReasonOpen(true)}
        disabled={acknowledge.isPending}
        aria-busy={acknowledge.isPending}
        className="shrink-0 rounded-[9px] border border-[#f0e2c4] bg-card px-3 py-1.5 text-[11.5px] font-bold text-twn transition-colors hover:bg-swn/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
      >
        Acknowledge
      </button>
      {localError && (
        <p role="alert" className="text-[11px] font-semibold text-tdn">
          {localError}
        </p>
      )}

      <ReasonModal
        open={reasonOpen}
        onOpenChange={setReasonOpen}
        title="Acknowledge exposure alert"
        onContinue={onReason}
      />

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />
    </div>
  )
}
