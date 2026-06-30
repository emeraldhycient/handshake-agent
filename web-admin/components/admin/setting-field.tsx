"use client"

/**
 * SettingField — renders one effective config leaf (root CLAUDE.md §7) by its
 * `valueType` and, when editable, lets an operator override it:
 *
 *   number   → number input + Save        string   → text input + Save
 *   boolean  → Switch (saves on toggle)    string[] → comma/line editor + Save
 *
 * A `source` badge shows provenance — 'db' = an active override ("overridden",
 * info), 'default' = the env/JSON baseline ("default", neutral). `editable=false`
 * keys (env/JSON-only) render disabled with no Save.
 *
 * The PATCH is sensitive: it may 403 with ADMIN_STEP_UP_REQUIRED, so the save is
 * wrapped in `useStepUpRetry` — on a challenge we open the StepUpDialog and retry
 * after re-auth. A server validation error (ADMIN_SETTING_INVALID /
 * ADMIN_MULTI_CURRENCY_INVARIANT) surfaces inline.
 */
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useUpdateSetting } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import type { SettingFieldProps } from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

/** Render an unknown effective value as the string the text/number editor seeds with. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
}

/** Render a string[] value as a newline-joined editor seed. */
function toLines(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join("\n") : ""
}

/** Parse a comma-or-newline string[] editor back into a trimmed, non-empty array. */
function parseLines(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function SettingField({ setting }: SettingFieldProps) {
  const me = useAdminMe()
  const update = useUpdateSetting()
  const stepUp = useStepUpRetry()
  const [localError, setLocalError] = useState<string | null>(null)

  // Local draft, seeded from the effective value. Booleans toggle directly; the
  // text/number/list editors hold a string the operator commits with Save.
  const [draft, setDraft] = useState<string>(
    setting.valueType === "string[]"
      ? toLines(setting.value)
      : toText(setting.value)
  )

  const disabled = !setting.editable
  const fieldId = `setting-${setting.key}`

  async function save(nextValue: unknown) {
    setLocalError(null)
    try {
      await stepUp.run(() =>
        update
          .mutateAsync({
            key: setting.key,
            input: {
              value: nextValue,
              scope: setting.scope,
              scopeValue: setting.scopeValue,
            },
          })
          .then(() => undefined)
      )
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  function saveText() {
    if (setting.valueType === "number") {
      void save(Number(draft))
    } else if (setting.valueType === "string[]") {
      void save(parseLines(draft))
    } else {
      void save(draft)
    }
  }

  const busy = update.isPending
  const dirty =
    setting.valueType === "string[]"
      ? draft !== toLines(setting.value)
      : draft !== toText(setting.value)

  return (
    <div className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={fieldId} className="font-semibold">
            {setting.label}
          </Label>
          <p className="text-xs text-muted-foreground">{setting.description}</p>
          <p className="font-mono text-[11px] text-muted-foreground/80">
            {setting.key}
          </p>
        </div>
        <Badge
          variant={setting.source === "db" ? "secondary" : "outline"}
          aria-label={
            setting.source === "db"
              ? "Overridden by a database setting"
              : "Using the env/JSON default"
          }
        >
          {setting.source === "db" ? "overridden" : "default"}
        </Badge>
      </div>

      {/* ── Editor by value type ─────────────────────────────────────────────── */}
      {setting.valueType === "boolean" ? (
        <div className="flex items-center gap-2">
          <Switch
            id={fieldId}
            aria-label={setting.label}
            checked={setting.value === true}
            disabled={disabled || busy}
            onCheckedChange={(checked) => void save(checked)}
          />
          <span className="text-xs text-muted-foreground">
            {setting.value === true ? "Enabled" : "Disabled"}
          </span>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          {setting.valueType === "string[]" ? (
            <textarea
              id={fieldId}
              aria-label={setting.label}
              value={draft}
              disabled={disabled || busy}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="One value per line (or comma-separated)"
              rows={3}
              className="min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            />
          ) : (
            <Input
              id={fieldId}
              aria-label={setting.label}
              type={setting.valueType === "number" ? "number" : "text"}
              inputMode={setting.valueType === "number" ? "decimal" : undefined}
              value={draft}
              disabled={disabled || busy}
              onChange={(e) => setDraft(e.target.value)}
              className="max-w-xs"
            />
          )}
          {!disabled && (
            <Button
              size="sm"
              onClick={saveText}
              disabled={busy || !dirty}
              aria-busy={busy}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      )}

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
