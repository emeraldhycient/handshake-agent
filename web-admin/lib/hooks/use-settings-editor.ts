"use client"

import { useMemo, useState } from "react"

import { UpdateSettingRequestSchema } from "@handshake-agent/contracts"

import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import { toRow } from "@/lib/settings/rows"
import type { SettingRow, SettingsFlowStep } from "@/types/components"

/** Config failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The layered-config editor state machine: the live effective settings, the client-side
 * key filter, and the DB-override edit chain (value → reason → step-up → maker-checker →
 * the real step-up-guarded PATCH). The server re-validates + hot-reloads + audits
 * `config_change` — it never moves money (§3.1/§3.2). A 403 opens the StepUpDialog and
 * the PATCH replays after re-auth. Extracted from the page so the orchestrator is pure
 * composition.
 */
export function useSettingsEditor() {
  const query = useSettings()
  const rows = useMemo(() => (query.data ?? []).map(toRow), [query.data])

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<SettingRow | null>(null)
  const [step, setStep] = useState<SettingsFlowStep>(null)
  const [nextValue, setNextValue] = useState<unknown>(undefined)
  const [nextDisplay, setNextDisplay] = useState("")

  // Client-side key filter over the real rows (presentation only — never re-queries).
  const search_ = search.trim().toLowerCase()
  const visibleRows = useMemo(
    () =>
      search_
        ? rows.filter(
            (s) =>
              s.key.toLowerCase().includes(search_) ||
              s.desc.toLowerCase().includes(search_)
          )
        : rows,
    [rows, search_]
  )

  function startEdit(row: SettingRow) {
    setEditing(row)
    setNextValue(undefined)
    setNextDisplay("")
    setStep("value")
  }

  function closeFlow() {
    setStep(null)
    setEditing(null)
    setNextValue(undefined)
    setNextDisplay("")
  }

  // Value-entry Continue: a supplied value advances into the chain; Cancel closes.
  function onValueContinue(value: unknown, display: string) {
    if (value === undefined) {
      closeFlow()
      return
    }
    setNextValue(value)
    setNextDisplay(display)
    setStep("reason")
  }

  // The two intermediate flow transitions (reason → step-up → maker-checker).
  function onReasonContinue() {
    setStep("stepup")
  }
  function onStepUpComplete() {
    setStep("maker")
  }

  // The maker-checker submit APPLIES the override via the real step-up-guarded PATCH.
  function applyOverride() {
    if (!editing) return
    const body = UpdateSettingRequestSchema.parse({
      value: nextValue,
      scope: editing.scope,
      scopeValue: editing.scopeValue,
    })
    const key = editing.key
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting.mutateAsync({ key, input: body }).then(() => undefined)
        )
        if (ok) {
          pushToast(`Updated ${key}`, "ok")
          closeFlow()
        }
      } catch (error) {
        pushToast(toastError(error), "warn")
        closeFlow()
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((ok) => {
        if (ok && editing) {
          pushToast(`Updated ${editing.key}`, "ok")
        }
        closeFlow()
      })
      .catch((error) => {
        pushToast(toastError(error), "warn")
        closeFlow()
      })
  }

  return {
    query,
    rows,
    visibleRows,
    search,
    setSearch,
    editing,
    step,
    nextDisplay,
    me,
    stepUp,
    startEdit,
    closeFlow,
    onValueContinue,
    onReasonContinue,
    onStepUpComplete,
    applyOverride,
    onStepUpSuccess,
    flowTitle: editing ? `Edit ${editing.key}` : "Edit setting",
  }
}
