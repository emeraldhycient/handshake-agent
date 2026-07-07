"use client"

import { useMemo, useState } from "react"
import type {
  CreateChangeRequest,
  ReconBreak,
} from "@handshake-agent/contracts"

import { pushToast } from "@/lib/store/toast-store"
import {
  useAdminMe,
  useCreateChange,
  useMarkFailed,
  useRerunReconciliation,
  useRetrySettlement,
  useTransactionDetail,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { flowSpecFor, txActionError } from "@/lib/transactions/tx-detail"
import type { TxActivePhase, TxFlowKind } from "@/types/components"

/**
 * View-model for the TransactionDetail screen. Owns the read query + the four
 * engine-brokered triage mutations (retry / mark-failed / refund-change-request /
 * re-run-recon) and the flow state machine (which action is active, how far through
 * its reason → engine/maker steps, the captured reason, the inline recon result).
 *
 * Funds-safety (§3.1): the model only proposes — each terminal submit runs the REAL
 * mutation through `useStepUpRetry`, so a 403 ADMIN_STEP_UP_REQUIRED opens the
 * StepUpDialog and replays after re-auth. A refund APPLIES NOTHING here — it raises a
 * four-eyes change request a SECOND admin approves. Re-run recon is read-only. None
 * writes a raw ledger entry.
 */
export function useTransactionDetailScreen(transactionId: string) {
  const query = useTransactionDetail(transactionId)
  const tx = query.data

  const me = useAdminMe()
  const retry = useRetrySettlement()
  const markFailed = useMarkFailed()
  const createChange = useCreateChange()
  const rerunRecon = useRerunReconciliation()
  const stepUp = useStepUpRetry()

  const [copied, setCopied] = useState<string | null>(null)
  // The in-flight action + how far through its step list we are.
  const [activeKind, setActiveKind] = useState<TxFlowKind | null>(null)
  const [phase, setPhase] = useState<TxActivePhase>(null)
  // The reason captured in the ReasonModal — threaded into the audited mutation.
  const [reason, setReason] = useState("")
  // The last re-run-reconciliation outcome (breaks it detected) — shown inline once a
  // run completes. `null` = no run yet; the reconciled path returns an empty list.
  const [reconResult, setReconResult] = useState<ReconBreak[] | null>(null)

  const spec = useMemo(
    () => (activeKind && tx ? flowSpecFor(activeKind, tx) : null),
    [activeKind, tx]
  )

  const executing =
    retry.isPending ||
    markFailed.isPending ||
    createChange.isPending ||
    rerunRecon.isPending

  // The re-run-recon result panel's loading / error branches, derived (never seeded
  // into state). A step-up 403 is an expected re-auth prompt (the StepUpDialog is up
  // and will replay) — not a failure — so the error is suppressed while it is open.
  const reconLoading = rerunRecon.isPending
  const reconError =
    rerunRecon.isError && activeKind === "recon" && !stepUp.open
      ? txActionError(rerunRecon.error)
      : null

  function copy(value: string) {
    void navigator.clipboard?.writeText(value)
    setCopied(value)
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 1600)
  }

  function startAction(kind: TxFlowKind) {
    if (kind === "receipt") {
      // Design: no engine flow — just re-send the receipt and confirm via toast.
      pushToast("Receipt re-sent to the customer", "info")
      return
    }
    if (!tx) return
    const next = flowSpecFor(kind, tx)
    if (!next) return
    setReason("")
    // A fresh recon run supersedes any prior result panel.
    if (kind === "recon") setReconResult(null)
    setActiveKind(kind)
    setPhase(next.steps[0])
  }

  function closeFlow() {
    setActiveKind(null)
    setPhase(null)
    setReason("")
  }

  // The ReasonModal's Continue: stash the reason, advance to the terminal step.
  function onReason(entered: string) {
    setReason(entered)
    if (spec) setPhase(spec.steps[spec.steps.indexOf("reason") + 1] ?? null)
  }

  // The engine/maker terminal submit → the REAL mutation for the active action.
  function runMutation(): Promise<void> {
    if (!tx || !activeKind) return Promise.resolve()
    switch (activeKind) {
      case "retry":
        return retry.mutateAsync(tx.id).then(() => undefined)
      case "markFailed":
        return markFailed
          .mutateAsync({ id: tx.id, input: { reason } })
          .then(() => undefined)
      case "refund": {
        // A refund is a four-eyes CHANGE REQUEST — it applies NOTHING here; a
        // second admin approves it, then the engine's atomic refund runs (§3.1).
        const input: CreateChangeRequest = {
          kind: "refund",
          resource: `Transaction:${tx.id}`,
          payload: { transactionId: tx.id, reason },
          reason,
        }
        return createChange.mutateAsync(input).then(() => undefined)
      }
      case "recon":
        // Read-only detection: re-run recon for this txn and stash the detected
        // breaks for the inline result panel (reason is optional — omitted here).
        return rerunRecon
          .mutateAsync({ id: tx.id, reason: reason || undefined })
          .then((res) => {
            setReconResult(res.items)
          })
      default:
        return Promise.resolve()
    }
  }

  function submitFlow() {
    const kind = activeKind
    void (async () => {
      const completed = await stepUp.run(runMutation).catch((error) => {
        pushToast(txActionError(error), "warn")
        return false
      })
      // `completed` is false when a step-up challenge opened (retry pending) — keep
      // the flow open so the StepUpDialog's success can replay it.
      if (completed) {
        // Re-run recon's feedback is its inline result panel — no toast needed.
        if (kind !== "recon") {
          pushToast(
            kind === "refund"
              ? "Refund submitted for approval"
              : "Action executed via the engine",
            "ok"
          )
        }
        closeFlow()
      }
    })()
  }

  // The real step-up's success → replay the stashed mutation, then confirm + close.
  function onStepUpSuccess() {
    const kind = activeKind
    void stepUp
      .retry()
      .then((replayed) => {
        if (!replayed) return
        // Re-run recon's feedback is its inline result panel — no toast.
        if (kind !== "recon") {
          pushToast(
            kind === "refund"
              ? "Refund submitted for approval"
              : "Action executed via the engine",
            "ok"
          )
        }
        closeFlow()
      })
      .catch((error) => pushToast(txActionError(error), "warn"))
  }

  return {
    query,
    tx,
    mfaEnabled: me.data?.mfaEnabled ?? false,
    copied,
    copy,
    phase,
    reconResult,
    spec,
    executing,
    reconLoading,
    reconError,
    startAction,
    closeFlow,
    onReason,
    submitFlow,
    stepUp,
    onStepUpSuccess,
  }
}
