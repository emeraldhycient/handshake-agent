"use client"

import { useMemo, useState } from "react"

import { useAdminMe, useCreateChange, useSettings } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import { buildRows } from "@/lib/capabilities/build"
import { MIN_CHANGE_REQUEST_REASON } from "@/constants/approvals"

/** Capability failures always surface a string toast (never null). */
function toastError(error: unknown): string {
  return toErrorMessage(error) ?? "Something went wrong."
}

/** The kill-switch flip chain: reason → dual-control confirm (the raise is step-up-guarded). */
type CapabilityFlowStep = "reason" | "maker"

/**
 * The Capabilities switchboard state machine: resolves the live kill-switch rows from
 * the `catalog.capabilities.crypto.*` registry, and drives the reason → maker-checker →
 * step-up flip. A toggle is a KILL-SWITCH (§7) — never a direct flip; submitting RAISES
 * a four-eyes `capability_flip` ChangeRequest that a SECOND admin approves (§3.1), at
 * which point the config applier re-validates + hot-reloads + audits server-side. A 403
 * opens the StepUpDialog and the raise replays after re-auth. Nothing moves money (§3.1).
 */
export function useCapabilityToggles() {
  const query = useSettings("Catalog")
  const rows = useMemo(() => buildRows(query.data ?? []), [query.data])

  const me = useAdminMe()
  const createChange = useCreateChange()
  const stepUp = useStepUpRetry()

  // Which capability's toggle is being flipped, and how far through the reason →
  // dual-control chain. Held by id so the resolved row (with its setting key) is
  // re-derived from the freshest rows; `step` is null when no flip is in flight.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [step, setStep] = useState<CapabilityFlowStep | null>(null)
  const [reason, setReason] = useState("")
  const pending = rows.find((r) => r.id === pendingId) ?? null

  // The from→to change preview for the maker-checker modal (design's diff table).
  const diff = useMemo(() => {
    if (!pending) return []
    return [
      {
        field: `capability: ${pending.label}`,
        from: pending.on ? "Enabled" : "Disabled",
        to: pending.on ? "Disabled" : "Enabled",
      },
    ]
  }, [pending])

  function openToggle(id: string) {
    setPendingId(id)
    setReason("")
    setStep("reason")
  }
  function closeToggle() {
    setPendingId(null)
    setStep(null)
    setReason("")
  }

  // The ReasonModal enforces the 3-char floor (min length), but guard defensively so a
  // too-short reason can never advance to the maker step and raise the request.
  function onReasonContinue(entered: string) {
    if (entered.trim().length < MIN_CHANGE_REQUEST_REASON) return
    setReason(entered.trim())
    setStep("maker")
  }

  /**
   * Raise a four-eyes `capability_flip` ChangeRequest for the kill-switch flip. This
   * APPLIES NOTHING — it enters a SECOND admin's approvals inbox (§3.1/§7); the payload
   * mirrors the direct-write body 1:1 for the config applier to re-validate. A 403 opens
   * the StepUpDialog and this replays after re-auth.
   */
  function approveToggle() {
    if (!pending) return
    if (reason.trim().length < MIN_CHANGE_REQUEST_REASON) return
    const cap = pending
    const enabling = !cap.on
    const changeReason = reason.trim()
    closeToggle()
    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          createChange
            .mutateAsync({
              kind: "capability_flip",
              resource: cap.settingKey,
              payload: {
                key: cap.settingKey,
                value: enabling,
                scope: cap.scope,
                scopeValue: cap.scopeValue,
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

  return {
    query,
    rows,
    me,
    stepUp,
    pending,
    step,
    diff,
    openToggle,
    closeToggle,
    onReasonContinue,
    approveToggle,
    onStepUpSuccess,
  }
}
