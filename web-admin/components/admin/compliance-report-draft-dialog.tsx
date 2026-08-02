"use client"

/**
 * ComplianceReportDraftDialog — draft a SAR/STR report (Phase 3, sub-area C).
 * Composition only: the form state + step-up-gated submission live in
 * `useComplianceReportDraft`, the inputs in `DraftFormFields`. The form body
 * mounts only while open so its state initializers reset on each open without a
 * state-syncing effect. The model proposes; the engine re-validates + settles (§3.1).
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DraftFormFields } from "@/components/admin/compliance-report-draft/draft-form-fields"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useComplianceReportDraft } from "@/lib/hooks/use-compliance-report-draft"
import type { ComplianceReportDraftDialogProps } from "@/types"

function DraftForm({ onClose }: { onClose: () => void }) {
  const form = useComplianceReportDraft(onClose)

  return (
    <>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Draft compliance report</DialogTitle>
          <DialogDescription>
            Create a SAR/STR draft from related compliance events.
          </DialogDescription>
        </DialogHeader>

        <DraftFormFields
          reportType={form.reportType}
          onReportTypeChange={form.setReportType}
          eventsText={form.eventsText}
          onEventsTextChange={form.setEventsText}
          content={form.content}
          onContentChange={form.setContent}
          busy={form.busy}
          error={form.localError}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={form.busy}>
            Cancel
          </Button>
          <Button onClick={form.submit} disabled={form.busy} aria-busy={form.busy}>
            Draft
          </Button>
        </DialogFooter>
      </DialogContent>

      <StepUpDialog
        open={form.stepUp.open}
        mfaEnabled={form.me.data?.mfaEnabled ?? false}
        onOpenChange={form.stepUp.setOpen}
        onSuccess={form.onStepUpSuccess}
      />
    </>
  )
}

export function ComplianceReportDraftDialog({
  open,
  onOpenChange,
}: ComplianceReportDraftDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <DraftForm onClose={() => onOpenChange(false)} />}
    </Dialog>
  )
}
