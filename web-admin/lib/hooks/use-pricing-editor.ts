"use client"

import { useMemo, useState } from "react"

import { useAdminMe, useCreateChange, useSettings } from "@/lib/query/hooks"
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
import { MIN_CHANGE_REQUEST_REASON } from "@/constants/approvals"
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
 * step-up → maker-checker → a four-eyes `pricing_change` ChangeRequest). Every leaf
 * DERIVES the user-facing rate/margin — nothing stores a line item (§3.1). A raise does
 * NOT apply: it lands in a SECOND admin's approvals inbox (the maker can never
 * self-approve). A 403 opens the StepUpDialog and the raise replays after re-auth.
 * Extracted so the page is composition.
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
  const createChange = useCreateChange()
  const stepUp = useStepUpRetry()

  const [target, setTarget] = useState<EditTarget | null>(null)
  const [newValue, setNewValue] = useState("")
  const [step, setStep] = useState<PricingFlowStep | null>(null)
  const [reason, setReason] = useState("")
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
    setReason("")
  }

  // Flow transitions (value → reason → confirm). The REAL step-up is server-driven:
  // the raise 403s and the StepUpDialog replays it.
  function onValueContinue() {
    setStep("reason")
  }
  // The ReasonModal enforces the 3-char floor (min length), but guard defensively so a
  // too-short reason can never advance to the maker step and raise the request.
  function onReasonContinue(entered: string) {
    if (entered.trim().length < MIN_CHANGE_REQUEST_REASON) return
    setReason(entered.trim())
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

  /**
   * Raise a four-eyes `pricing_change` ChangeRequest against the target key. This
   * APPLIES NOTHING — it enters a SECOND admin's approvals inbox (§3.1); the payload
   * mirrors the direct-write body 1:1 for the config applier to re-validate. A 403
   * opens the StepUpDialog and this replays after re-auth.
   */
  function approve() {
    if (!target || parsed === null) return
    if (reason.trim().length < MIN_CHANGE_REQUEST_REASON) return
    const t = target
    const value = parsed
    const changeReason = reason.trim()
    closeFlow()
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          createChange
            .mutateAsync({
              kind: "pricing_change",
              resource: t.key,
              payload: {
                key: t.key,
                value,
                scope: t.scope,
                scopeValue: t.scopeValue,
              },
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
