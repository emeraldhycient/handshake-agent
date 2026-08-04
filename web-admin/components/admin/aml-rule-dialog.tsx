"use client"

/**
 * AmlRuleDialog — create or edit an AML engine rule (Phase 3, sub-area C). Composition
 * only: the Dialog shell mounts the `AmlRuleForm` body ONLY while open, so its state
 * initializers seed from `rule` without a state-syncing effect (closing remounts it
 * fresh). The create/edit + step-up state machine lives in `useAmlRuleForm`.
 *
 * On edit only the mutable fields are sent (ruleKey + ruleType are immutable). Both
 * writes are step-up-gated (403 → StepUpDialog → replay). Nothing moves money (§3.1).
 */
import { Dialog } from "@/components/ui/dialog"
import { AmlRuleForm } from "@/components/admin/aml/aml-rule-form"
import type { AmlRuleDialogProps } from "@/types"

export function AmlRuleDialog({
  open,
  onOpenChange,
  rule,
}: AmlRuleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <AmlRuleForm rule={rule} onClose={() => onOpenChange(false)} />}
    </Dialog>
  )
}
