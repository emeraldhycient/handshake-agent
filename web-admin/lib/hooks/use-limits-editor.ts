"use client"

import { useMemo, useState } from "react"

import {
  useAdminMe,
  useCreateChange,
  usePublicConfig,
  useSettings,
} from "@/lib/query/hooks"
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
import { MIN_CHANGE_REQUEST_REASON } from "@/constants/approvals"
import { DEFAULT_DISPLAY_FIAT } from "@/constants/currencies"
import type { LimitEditLeaf, LimitTier, LimitTierId } from "@/types/components"

/** The edit flow steps: value → reason → confirm (the raise is step-up-guarded server-side). */
type LimitFlowStep = "value" | "reason" | "maker"

type EditableRow = LimitTier["amountCaps"][number]

/** Limit failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The Limits & velocity editor state machine: resolves the per-tier/per-currency caps from
 * the settings registry and drives the dual-control edit chain (value → reason → step-up →
 * maker-checker → a four-eyes `tier_override` ChangeRequest on the leaf's backing key). A
 * "—" placeholder never exposes an editor (§3.6). A raise APPLIES NOTHING — it lands in a
 * SECOND admin's approvals inbox (§3.1). A 403 opens the StepUpDialog and the raise replays
 * after re-auth. Nothing moves money (§3.1). Extracted so the page is composition.
 */
export function useLimitsEditor() {
  const query = useSettings()

  const me = useAdminMe()
  const createChange = useCreateChange()
  const stepUp = useStepUpRetry()

  const settings = useMemo(() => query.data ?? [], [query.data])

  // The catalog's configured default fiat (first enabled `/config` currency) —
  // never a hardcoded 'NGN' literal (root CLAUDE.md §7). Falls back to
  // DEFAULT_DISPLAY_FIAT only until `/config` has resolved.
  const publicConfig = usePublicConfig()
  const defaultFiat = publicConfig.data?.fiats[0]?.code ?? DEFAULT_DISPLAY_FIAT

  const currencies = useMemo(
    () => availableCurrencies(settings, defaultFiat),
    [settings, defaultFiat]
  )
  const settingsByKey = useMemo(
    () => new Map(settings.map((s) => [s.key, s])),
    [settings]
  )

  const [currency, setCurrency] = useState(defaultFiat)
  const activeCurrency = currencies.includes(currency)
    ? currency
    : (currencies[0] ?? defaultFiat)
  const tiers = useMemo<LimitTier[]>(
    () => buildTiers(settings, activeCurrency),
    [settings, activeCurrency]
  )

  const [tierId, setTierId] = useState<LimitTierId>("tier_1")
  const tier = tiers.find((t) => t.id === tierId) ?? tiers[0]

  const [editing, setEditing] = useState<EditableRow | null>(null)
  const [newValue, setNewValue] = useState("")
  const [flow, setFlow] = useState<LimitFlowStep | null>(null)
  const [reason, setReason] = useState("")

  function startEdit(row: EditableRow) {
    if (!row.edit) return
    const raw = settingsByKey.get(row.edit.key)?.value
    setEditing(row)
    setNewValue(typeof raw === "number" ? String(raw) : "")
    setReason("")
    setFlow("value")
  }

  function closeFlow() {
    setFlow(null)
    setEditing(null)
    setNewValue("")
    setReason("")
  }

  // The ReasonModal enforces the 3-char floor (min length), but guard defensively so a
  // too-short reason can never advance to the maker step and raise the request.
  function onReasonContinue(entered: string) {
    if (entered.trim().length < MIN_CHANGE_REQUEST_REASON) return
    setReason(entered.trim())
    setFlow("maker")
  }

  const parsed = parseCap(newValue)
  const leaf: LimitEditLeaf | undefined = editing?.edit

  // A per-currency leaf (`limits.<code>.<tier>.*`) is labelled with the currency + tier; a
  // global leaf (e.g. the new-beneficiary hold) carries neither, so no misleading suffix.
  const tierSuffix = (l: LimitEditLeaf | undefined): string =>
    l && l.key.startsWith("limits.") && tier
      ? ` · ${activeCurrency} ${tier.label}`
      : ""

  /**
   * Raise a four-eyes `tier_override` ChangeRequest on the leaf's backing key. This
   * APPLIES NOTHING — it enters a SECOND admin's approvals inbox (§3.1); the payload
   * mirrors the direct-write body 1:1 for the config applier to re-validate. A 403 opens
   * the StepUpDialog and this replays after re-auth.
   */
  function applyEdit() {
    if (!editing || !leaf || parsed === null) return
    if (reason.trim().length < MIN_CHANGE_REQUEST_REASON) return
    const value = parsed
    const key = leaf.key
    const scope = leaf.scope
    const scopeValue = leaf.scopeValue
    const changeReason = reason.trim()
    closeFlow()
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          createChange
            .mutateAsync({
              kind: "tier_override",
              resource: key,
              payload: { key, value, scope, scopeValue },
              reason: changeReason,
            })
            .then(() => undefined)
        )
        if (ok) pushToast("Submitted for approval", "ok")
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
    onReasonContinue,
    applyEdit,
    onStepUpSuccess,
    me,
    stepUp,
  }
}
