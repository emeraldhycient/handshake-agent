"use client"

/**
 * TemplateEditorDialog — create or edit a notification template (Phase 4). Composition
 * only: the Dialog shell mounts the `TemplateForm` body ONLY while open, so its state
 * initializers seed from `template` without a state-syncing effect (closing remounts it
 * fresh). The form's create/edit state machine + live preview live in
 * `components/admin/templates/editor/*` and `lib/hooks/use-template-form`.
 *
 * Save is sensitive — the upsert runs through the step-up gate (a 403 opens the
 * StepUpDialog and replays after re-auth). On edit the composite key (templateKey +
 * language + channel) is immutable. Nothing here moves money (§3.1).
 */
import { Dialog } from "@/components/ui/dialog"
import { TemplateForm } from "@/components/admin/templates/editor/template-form"
import type { TemplateEditorDialogProps } from "@/types/components"

export function TemplateEditorDialog({
  open,
  onOpenChange,
  template,
}: TemplateEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <TemplateForm template={template} onClose={() => onOpenChange(false)} />
      )}
    </Dialog>
  )
}
