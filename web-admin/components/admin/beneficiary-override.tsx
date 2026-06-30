"use client"

/**
 * BeneficiaryOverride — clears a beneficiary's first-use cooling-off lock (IDN-08).
 * Shown only while the lock is active (`coolingOffActive`). The override is
 * sensitive — we attempt the mutation, and if it 403s with ADMIN_STEP_UP_REQUIRED
 * we open the StepUpDialog and retry after re-auth (`useStepUpRetry`). Nothing
 * here moves money (§3.1).
 */
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useOverrideCoolingOff } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { BeneficiaryOverrideProps } from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function BeneficiaryOverride({ beneficiary }: BeneficiaryOverrideProps) {
  const me = useAdminMe()
  const override = useOverrideCoolingOff()
  const stepUp = useStepUpRetry()
  const [localError, setLocalError] = useState<string | null>(null)

  function onOverride() {
    setLocalError(null)
    void (async () => {
      try {
        await stepUp.run(() =>
          override.mutateAsync(beneficiary.id).then(() => undefined)
        )
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

  if (!beneficiary.coolingOffActive) return null

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={override.isPending}
        aria-busy={override.isPending}
        onClick={onOverride}
      >
        Override cooling-off
      </Button>
      {localError && (
        <p role="alert" className="text-xs text-destructive">
          {localError}
        </p>
      )}

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
