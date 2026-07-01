"use client"

/**
 * SettingField — renders one effective config leaf (root CLAUDE.md §7) as a row
 * of the settings table (design §6.30: Key · Effective value · Source · Description
 * · Edit) and, when editable, lets an operator override it:
 *
 *   number   → number input + Save        string   → text input + Save
 *   boolean  → Switch (saves on toggle)    string[] → comma/line editor + Save
 *
 * A `source` chip shows provenance — 'db' = an active override ("overridden",
 * info surface), 'default' = the env/JSON baseline ("default", neutral). Non-
 * editable keys (env/JSON-only) render disabled with no Save.
 *
 * The PATCH is sensitive: it may 403 with ADMIN_STEP_UP_REQUIRED, so the save is
 * wrapped in `useStepUpRetry` — on a challenge we open the StepUpDialog (the
 * design step-up flow-modal) and retry after re-auth. A server validation error
 * (ADMIN_SETTING_INVALID / ADMIN_MULTI_CURRENCY_INVARIANT) surfaces inline.
 */
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { useAdminMe, useUpdateSetting } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"
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

export function SettingField({ setting, gridClassName }: SettingFieldProps) {
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
  const isBoolean = setting.valueType === "boolean"
  const dirty =
    setting.valueType === "string[]"
      ? draft !== toLines(setting.value)
      : draft !== toText(setting.value)
  const isOverride = setting.source === "db"

  return (
    <div className="border-b border-line2 last:border-b-0">
      {/* ── Table-grid row (design §6.30) ────────────────────────────────────── */}
      <div
        className={cn(
          "grid items-center gap-3 px-[18px] py-[13px]",
          gridClassName
        )}
      >
        {/* Key + type/scope meta */}
        <div className="min-w-0">
          <label
            htmlFor={fieldId}
            className="block truncate font-mono text-[12px] font-bold text-ink"
          >
            {setting.key}
          </label>
          <div className="text-[10.5px] text-ink3">
            {setting.valueType} · {setting.editable ? "editable" : "read-only"}
          </div>
        </div>

        {/* Effective value */}
        <div className="min-w-0">
          {isBoolean ? (
            <span className="font-mono text-[12.5px] font-bold text-ink">
              {setting.value === true ? "true" : "false"}
            </span>
          ) : (
            <span className="block truncate font-mono text-[12.5px] font-bold text-ink">
              {toText(setting.value) || "—"}
            </span>
          )}
        </div>

        {/* Source chip (chain-resolution provenance) */}
        <div>
          <span
            aria-label={
              isOverride
                ? "Overridden by a database setting"
                : "Using the env/JSON default"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-[3px] text-[10.5px] font-extrabold",
              isOverride ? "bg-sif text-tif" : "bg-card2 text-ink2"
            )}
          >
            {isOverride ? "overridden" : "default"}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 16v-5M12 8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </span>
        </div>

        {/* Description */}
        <div className="text-[11.5px] leading-[1.35] text-ink2">
          {setting.description}
        </div>

        {/* Edit column — inline editor (Switch, or input/textarea + Save) */}
        <div className="flex items-center justify-end gap-2">
          {isBoolean ? (
            <Switch
              id={fieldId}
              aria-label={setting.label}
              checked={setting.value === true}
              disabled={disabled || busy}
              onCheckedChange={(checked) => void save(checked)}
            />
          ) : (
            <>
              {setting.valueType === "string[]" ? (
                <textarea
                  id={fieldId}
                  aria-label={setting.label}
                  value={draft}
                  disabled={disabled || busy}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="One per line / comma-separated"
                  rows={2}
                  className="min-h-9 w-full min-w-0 rounded-[10px] border border-line bg-field px-2.5 py-1.5 font-mono text-[12px] text-ink transition-[color,box-shadow] outline-none placeholder:text-ink3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                />
              ) : (
                <Input
                  id={fieldId}
                  aria-label={setting.label}
                  type={setting.valueType === "number" ? "number" : "text"}
                  inputMode={
                    setting.valueType === "number" ? "decimal" : undefined
                  }
                  value={draft}
                  disabled={disabled || busy}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-9 min-w-0 font-mono text-[12px]"
                />
              )}
              {!disabled && (
                <Button
                  size="sm"
                  onClick={saveText}
                  disabled={busy || !dirty}
                  aria-busy={busy}
                  className="flex-none"
                >
                  {busy ? "Saving…" : "Save"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Inline validation error (full-width under the row) ───────────────── */}
      {localError && (
        <p
          role="alert"
          className="px-[18px] pb-3 text-[11.5px] font-semibold text-tdn"
        >
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
