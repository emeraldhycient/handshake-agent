"use client"

import { useState } from "react"

import {
  useAcknowledgeReconRunBreak,
  useAdminMe,
  useReconRuns,
  useResolveReconRunBreak,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import type { ReconActionKind, ReconPendingAction } from "@/types/components"

/**
 * The durable reconciliation-run history state machine: lists persisted runs and drives
 * the per-break disposition — acknowledge (triage) or resolve (close), each an
 * annotation-only, step-up-gated, audited action that moves no money (§3.1). Every
 * disposition captures an audited reason (ReasonModal) then runs through the shared
 * step-up-then-retry flow (a 403 opens the StepUpDialog and replays on re-auth).
 * Extracted so the panel is composition.
 */
export function useReconRunHistory() {
  const runsQuery = useReconRuns()
  const me = useAdminMe()
  const ackMutation = useAcknowledgeReconRunBreak()
  const resolveMutation = useResolveReconRunBreak()
  const stepUp = useStepUpRetry()

  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<ReconPendingAction | null>(null)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  function toggleRun(runId: string) {
    setExpanded((cur) => (cur === runId ? null : runId))
  }

  function openReason(breakId: string, kind: ReconActionKind) {
    setLocalError(null)
    setPending({ breakId, kind })
    setReasonOpen(true)
  }

  function runDisposition(capturedReason: string) {
    const action = pending
    if (!action) return
    setReasonOpen(false)
    const mutate = action.kind === "resolve" ? resolveMutation : ackMutation
    void (async () => {
      try {
        await stepUp.run(() =>
          mutate
            .mutateAsync({ id: action.breakId, reason: capturedReason })
            .then(() => undefined)
        )
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp.retry().catch((error) => setLocalError(toErrorMessage(error)))
  }

  const reasonTitle =
    pending?.kind === "resolve"
      ? "Resolve reconciliation break"
      : "Acknowledge reconciliation break"

  return {
    runsQuery,
    me,
    stepUp,
    expanded,
    toggleRun,
    reasonOpen,
    setReasonOpen,
    reasonTitle,
    localError,
    openReason,
    runDisposition,
    onStepUpSuccess,
  }
}
