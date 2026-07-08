"use client"

import { useMemo, useState } from "react"

import { useAdminMe, useSetSetting, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import {
  bpsToPct,
  buildBaseRates,
  buildSpreadRows,
  num,
  parseValue,
  pricingCurrencies,
} from "@/lib/pricing/rows"
import {
  baseRateAddTarget,
  baseRateEditTarget,
  boundTarget,
  feeTarget,
  spreadTarget,
} from "@/lib/pricing/targets"
import type {
  EditTarget,
  PricingBaseRateRow,
  PricingFlowStep,
  SpreadRow,
} from "@/types/components"

/** Pricing failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/**
 * The Pricing-console state machine: pivots the flat `pricing.*` registry into spread
 * rows + base-rate rows, and drives the generalized numeric-edit chain (value → reason →
 * step-up → maker-checker → the real step-up-guarded PATCH). Every leaf DERIVES the
 * user-facing rate/margin — nothing stores a line item (§3.1). A 403 opens the
 * StepUpDialog and the PATCH replays after re-auth. Extracted so the page is composition.
 */
export function usePricingEditor() {
  const query = useSettings("Pricing")
  const settings = useMemo(() => query.data ?? [], [query.data])

  const currencies = useMemo(() => pricingCurrencies(settings), [settings])
  const [currency, setCurrency] = useState("NGN")
  const previewCurrency = currencies.includes(currency)
    ? currency
    : (currencies[0] ?? "NGN")

  const spreadRows = useMemo(
    () => buildSpreadRows(settings, previewCurrency),
    [settings, previewCurrency]
  )
  const { rows: baseRateRows, options: addOptions } = useMemo(
    () => buildBaseRates(settings),
    [settings]
  )
  const feeSetting = useMemo(
    () => settings.find((s) => s.key === "pricing.processingFeeBps"),
    [settings]
  )
  const feeBps = num(feeSetting)
  const feeLabel = feeBps === null ? "—" : bpsToPct(feeBps)

  const me = useAdminMe()
  const setSetting = useSetSetting()
  const stepUp = useStepUpRetry()

  const [target, setTarget] = useState<EditTarget | null>(null)
  const [newValue, setNewValue] = useState("")
  const [step, setStep] = useState<PricingFlowStep | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const parsed = target ? parseValue(newValue, target.integer) : null

  function startEdit(t: EditTarget, fromValueStep = true) {
    setTarget(t)
    setNewValue(t.seed)
    setStep(fromValueStep ? "value" : "reason")
  }
  function closeFlow() {
    setStep(null)
    setTarget(null)
    setNewValue("")
  }

  // Flow transitions (value → reason → step-up → maker-checker).
  function onValueContinue() {
    setStep("reason")
  }
  function onReasonContinue() {
    setStep("stepup")
  }
  function onStepUpComplete() {
    setStep("maker")
  }

  // Edit-target openers.
  const onEditSpread = (row: SpreadRow) => startEdit(spreadTarget(row))
  const onEditMin = (row: SpreadRow) => startEdit(boundTarget(row, "min"))
  const onEditMax = (row: SpreadRow) => startEdit(boundTarget(row, "max"))
  const onEditFee = () => startEdit(feeTarget(feeSetting, feeBps, feeLabel))
  const onEditBaseRate = (row: PricingBaseRateRow) =>
    startEdit(baseRateEditTarget(row))
  const onAddContinue = (choice: {
    asset: string
    code: string
    rate: number
  }) =>
    startEdit(baseRateAddTarget(choice.asset, choice.code, choice.rate), false)

  /** Approve the edit via the real step-up-guarded PATCH against the target key. */
  function approve() {
    if (!target || parsed === null) return
    const t = target
    const value = parsed
    closeFlow()
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          setSetting
            .mutateAsync({
              key: t.key,
              input: { value, scope: t.scope, scopeValue: t.scopeValue },
            })
            .then(() => undefined)
        )
        if (ok) pushToast(`${t.toastLabel} → ${t.format(value)}`, "ok")
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

  const flowTitle = target?.title ?? "Edit pricing"
  const diff =
    target && parsed !== null
      ? [
          {
            field: target.diffField,
            from: target.currentLabel,
            to: target.format(parsed),
          },
        ]
      : []

  return {
    query,
    currencies,
    previewCurrency,
    spreadRows,
    baseRateRows,
    addOptions,
    feeLabel,
    me,
    stepUp,
    target,
    newValue,
    step,
    addOpen,
    parsed,
    diff,
    flowTitle,
    setCurrency,
    setNewValue,
    setAddOpen,
    closeFlow,
    onValueContinue,
    onReasonContinue,
    onStepUpComplete,
    onEditSpread,
    onEditMin,
    onEditMax,
    onEditFee,
    onEditBaseRate,
    onAddContinue,
    approve,
    onStepUpSuccess,
  }
}
