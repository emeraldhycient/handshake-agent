"use client"

/**
 * AmlRuleDialog — create or edit an AML engine rule (Phase 3, sub-area C). On
 * create, the full shape is required (ruleKey / name / description / ruleType /
 * action / parameters JSON / enabled). On edit, only the mutable fields are sent
 * (name / description / action / parameters / enabled — ruleKey + ruleType are
 * immutable).
 *
 * `parameters` is edited as raw JSON in a textarea and parsed before submit; an
 * invalid JSON surfaces inline. Both create and edit are sensitive — we attempt
 * the mutation, and if it 403s with ADMIN_STEP_UP_REQUIRED we open the
 * StepUpDialog and retry after re-auth (`useStepUpRetry`).
 *
 * The form body is a child that mounts only while the dialog is open, so its
 * `useState` initializers seed from `rule` without a state-syncing effect
 * (avoids `react-hooks/set-state-in-effect`); closing remounts it fresh.
 */
import { useState } from "react"
import {
  AmlRuleCreateRequestSchema,
  AmlRuleUpdateRequestSchema,
} from "@handshake-agent/contracts"

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
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdminMe,
  useCreateAmlRule,
  useUpdateAmlRule,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { AmlRule } from "@handshake-agent/contracts"
import type { AmlRuleDialogProps } from "@/types/components"

const RULE_TYPES = AmlRuleCreateRequestSchema.shape.ruleType.options
const ACTIONS = AmlRuleCreateRequestSchema.shape.action.options

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

function parseParameters(
  raw: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: "Parameters must be a JSON object." }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: "Parameters is not valid JSON." }
  }
}

/** The form body — mounted only while open, so initializers seed from `rule`. */
function AmlRuleForm({
  rule,
  onClose,
}: {
  rule: AmlRule | null
  onClose: () => void
}) {
  const isEdit = rule !== null
  const me = useAdminMe()
  const create = useCreateAmlRule()
  const update = useUpdateAmlRule()
  const stepUp = useStepUpRetry()

  const [ruleKey, setRuleKey] = useState(rule?.ruleKey ?? "")
  const [name, setName] = useState(rule?.name ?? "")
  const [description, setDescription] = useState(rule?.description ?? "")
  const [ruleType, setRuleType] = useState<(typeof RULE_TYPES)[number]>(
    rule?.ruleType ?? RULE_TYPES[0]
  )
  const [action, setAction] = useState<(typeof ACTIONS)[number]>(
    rule?.action ?? ACTIONS[0]
  )
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [parameters, setParameters] = useState(
    rule ? JSON.stringify(rule.parameters, null, 2) : "{}"
  )
  const [localError, setLocalError] = useState<string | null>(null)

  function onSubmit() {
    setLocalError(null)
    const params = parseParameters(parameters)
    if (!params.ok) {
      setLocalError(params.error)
      return
    }

    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          isEdit
            ? update
                .mutateAsync({
                  id: rule.id,
                  input: AmlRuleUpdateRequestSchema.parse({
                    name,
                    description,
                    action,
                    enabled,
                    parameters: params.value,
                  }),
                })
                .then(() => undefined)
            : create
                .mutateAsync(
                  AmlRuleCreateRequestSchema.parse({
                    ruleKey,
                    name,
                    description,
                    ruleType,
                    action,
                    enabled,
                    parameters: params.value,
                  })
                )
                .then(() => undefined)
        )
        if (ok) onClose()
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

  const busy = create.isPending || update.isPending

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
              value={ruleKey}
              disabled={busy || isEdit}
              onChange={(e) => setRuleKey(e.target.value)}
              placeholder="velocity.daily_amount"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aml-name">Name</Label>
            <Input
              id="aml-name"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aml-description">Description</Label>
            <Input
              id="aml-description"
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="aml-type">Rule type</Label>
              <NativeSelect
                id="aml-type"
                value={ruleType}
                disabled={busy || isEdit}
                onChange={(e) =>
                  setRuleType(e.target.value as (typeof RULE_TYPES)[number])
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
                value={action}
                disabled={busy}
                onChange={(e) =>
                  setAction(e.target.value as (typeof ACTIONS)[number])
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
              checked={enabled}
              disabled={busy}
              onCheckedChange={setEnabled}
              aria-label="Rule enabled"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aml-parameters">Parameters (JSON)</Label>
            <textarea
              id="aml-parameters"
              value={parameters}
              disabled={busy}
              onChange={(e) => setParameters(e.target.value)}
              rows={5}
              spellCheck={false}
              className="min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            />
          </div>

          {localError && (
            <p role="alert" className="text-xs text-destructive">
              {localError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy} aria-busy={busy}>
            {isEdit ? "Save" : "Create"}
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
