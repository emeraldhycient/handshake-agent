"use client"

import { useMemo, useState } from "react"

import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import {
  availableCurrencies,
  buildTiers,
  fieldLabelFor,
  formatLeaf,
  parseCap,
} from "@/lib/limits/rows"
import type { LimitEditLeaf, LimitTier, LimitTierId } from "@/types/components"

/** The edit flow steps: value → reason → confirm (the PATCH is step-up-guarded server-side). */
type LimitFlowStep = "value" | "reason" | "maker"

type EditableRow = LimitTier["amountCaps"][number]

/** Limit failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The Limits & velocity editor state machine: resolves the per-tier/per-currency caps from
 * the settings registry and drives the dual-control edit chain (value → reason → step-up →
 * maker-checker → the real step-up-guarded PATCH on the leaf's backing key). A "—"
 * placeholder never exposes an editor (§3.6). A 403 opens the StepUpDialog and the PATCH
 * replays after re-auth. Nothing moves money (§3.1). Extracted so the page is composition.
 */
export function useLimitsEditor() {
  const query = useSettings()

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  const settings = useMemo(() => query.data ?? [], [query.data])
  const currencies = useMemo(() => availableCurrencies(settings), [settings])
  const settingsByKey = useMemo(
    () => new Map(settings.map((s) => [s.key, s])),
    [settings]
  )

  const [currency, setCurrency] = useState("NGN")
  const activeCurrency = currencies.includes(currency)
    ? currency
    : (currencies[0] ?? "NGN")
  const tiers = useMemo<LimitTier[]>(
    () => buildTiers(settings, activeCurrency),
    [settings, activeCurrency]
  )

  const [tierId, setTierId] = useState<LimitTierId>("tier_1")
  const tier = tiers.find((t) => t.id === tierId) ?? tiers[0]

  const [editing, setEditing] = useState<EditableRow | null>(null)
  const [newValue, setNewValue] = useState("")
  const [flow, setFlow] = useState<LimitFlowStep | null>(null)

  function startEdit(row: EditableRow) {
    if (!row.edit) return
    const raw = settingsByKey.get(row.edit.key)?.value
    setEditing(row)
    setNewValue(typeof raw === "number" ? String(raw) : "")
    setFlow("value")
  }

  function closeFlow() {
    setFlow(null)
    setEditing(null)
    setNewValue("")
  }

  const parsed = parseCap(newValue)
  const leaf: LimitEditLeaf | undefined = editing?.edit

  // A per-currency leaf (`limits.<code>.<tier>.*`) is labelled with the currency + tier; a
  // global leaf (e.g. the new-beneficiary hold) carries neither, so no misleading suffix.
  const tierSuffix = (l: LimitEditLeaf | undefined): string =>
    l && l.key.startsWith("limits.") && tier
      ? ` · ${activeCurrency} ${tier.label}`
      : ""

  /** Approve the dual-control edit via the real step-up-guarded PATCH. */
  function applyEdit() {
    if (!editing || !leaf || parsed === null) return
    const label = `${editing.k}${tierSuffix(leaf)}`
    const kind = leaf.kind
    const value = parsed
    const key = leaf.key
    const scope = leaf.scope
    const scopeValue = leaf.scopeValue
    closeFlow()
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({ key, input: { value, scope, scopeValue } })
            .then(() => undefined)
        )
        if (ok)
          pushToast(
            `${label} → ${formatLeaf(kind, value, activeCurrency)}`,
            "ok"
          )
      } catch (error) {
        pushToast(toastError(error), "warn")
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then(() => undefined)
      .catch((error) => pushToast(toastError(error), "warn"))
  }

  const flowTitle = editing
    ? `Edit ${editing.k}${tierSuffix(leaf)}`
    : "Edit limit"
  const fieldLabel = leaf
    ? fieldLabelFor(leaf.kind, activeCurrency)
    : "New value"
  const makerDiff =
    editing && leaf && parsed !== null
      ? [
          {
            field: `${editing.k}${tierSuffix(leaf)}`,
            from: editing.v,
            to: formatLeaf(leaf.kind, parsed, activeCurrency),
          },
        ]
      : []

  return {
    query,
    tiers,
    tierId,
    setTierId,
    tier,
    currencies,
    activeCurrency,
    setCurrency,
    editing,
    newValue,
    setNewValue,
    flow,
    setFlow,
    parsed,
    flowTitle,
    fieldLabel,
    currentValue: editing?.v ?? "",
    makerDiff,
    startEdit,
    closeFlow,
    applyEdit,
    onStepUpSuccess,
    me,
    stepUp,
  }
}
