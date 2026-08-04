"use client"

/**
 * ComplianceReportSubmitDialog — submit a drafted SAR/STR report (Phase 3, sub-area
 * C). Captures the external submission reference (the regulator's filing id) and
 * marks the draft submitted.
 *
 * Submission is sensitive — we attempt the mutation, and if it 403s with
 * ADMIN_STEP_UP_REQUIRED we open the StepUpDialog and retry after re-auth
 * (`useStepUpRetry`). The form body mounts only while open so its `useState`
 * initializers reset on each open without a state-syncing effect.
 */
import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useSubmitReport } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { ComplianceReport } from "@handshake-agent/contracts"
import type { ComplianceReportSubmitDialogProps } from "@/types"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

function SubmitForm({
  report,
  onClose,
}: {
  report: ComplianceReport
  onClose: () => void
}) {
  const me = useAdminMe()
  const submit = useSubmitReport()
  const stepUp = useStepUpRetry()
  const [submissionRef, setSubmissionRef] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  function onSubmit() {
    if (submissionRef.trim().length === 0) {
      setLocalError("A submission reference is required.")
      return
    }
    setLocalError(null)
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          submit
            .mutateAsync({
              id: report.id,
              input: { submissionRef: submissionRef.trim() },
            })
            .then(() => undefined)
        )
        if (ok) onClose()
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

  const busy = submit.isPending

  return (
    <>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit report</DialogTitle>
          <DialogDescription>
            Submitting {report.reportType.toUpperCase()} draft.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="submission-ref">Submission reference</Label>
          <Input
            id="submission-ref"
            value={submissionRef}
            disabled={busy}
            onChange={(e) => setSubmissionRef(e.target.value)}
            placeholder="Regulator filing id"
          />
        </div>

        {localError && (
          <p role="alert" className="text-xs text-destructive">
            {localError}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy} aria-busy={busy}>
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((ok) => {
              if (ok) onClose()
            })
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />
    </>
  )
}

export function ComplianceReportSubmitDialog({
  open,
  onOpenChange,
  report,
}: ComplianceReportSubmitDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && report && (
        <SubmitForm report={report} onClose={() => onOpenChange(false)} />
      )}
    </Dialog>
  )
}
