"use client"

import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAmlRuleForm } from "@/lib/hooks/use-aml-rule-form"
import {
  ACTIONS,
  PARAMS_TEXTAREA_CLASS,
  RULE_TYPES,
} from "@/constants/aml-rule"
import type { AmlRule } from "@handshake-agent/contracts"
import type { AmlRuleFormProps } from "@/types"

/** The form body — mounted only while open, so initializers seed from `rule`. */
export function AmlRuleForm({ rule, onClose }: AmlRuleFormProps) {
  const f = useAmlRuleForm(rule, onClose)
  const { fields, set, busy, isEdit } = f

  return (
    <>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit AML rule" : "New AML rule"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "ruleKey and ruleType are immutable."
              : "Define a versioned engine rule."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aml-key">Rule key</Label>
            <Input
              id="aml-key"
              value={fields.ruleKey}
              disabled={busy || isEdit}
              onChange={(e) => set.ruleKey(e.target.value)}
              placeholder="velocity.daily_amount"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aml-name">Name</Label>
            <Input
              id="aml-name"
              value={fields.name}
              disabled={busy}
              onChange={(e) => set.name(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aml-description">Description</Label>
            <Input
              id="aml-description"
              value={fields.description}
              disabled={busy}
              onChange={(e) => set.description(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="aml-type">Rule type</Label>
              <NativeSelect
                id="aml-type"
                value={fields.ruleType}
                disabled={busy || isEdit}
                onChange={(e) =>
                  set.ruleType(e.target.value as AmlRule["ruleType"])
                }
              >
                {RULE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="aml-action">Action</Label>
              <NativeSelect
                id="aml-action"
                value={fields.action}
                disabled={busy}
                onChange={(e) =>
                  set.action(e.target.value as AmlRule["action"])
                }
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="aml-enabled">Enabled</Label>
            <Switch
              id="aml-enabled"
              checked={fields.enabled}
              disabled={busy}
              onCheckedChange={set.enabled}
              aria-label="Rule enabled"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aml-parameters">Parameters (JSON)</Label>
            <textarea
              id="aml-parameters"
              value={fields.parameters}
              disabled={busy}
              onChange={(e) => set.parameters(e.target.value)}
              rows={5}
              spellCheck={false}
              className={PARAMS_TEXTAREA_CLASS}
            />
          </div>

          {f.localError && (
            <p role="alert" className="text-xs text-destructive">
              {f.localError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={f.onSubmit} disabled={busy} aria-busy={busy}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <StepUpDialog
        open={f.stepUp.open}
        mfaEnabled={f.me.data?.mfaEnabled ?? false}
        onOpenChange={f.stepUp.setOpen}
        onSuccess={f.onStepUpSuccess}
      />
    </>
  )
}
