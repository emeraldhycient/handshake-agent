"use client"

import { useState } from "react"

import { pushToast } from "@/lib/store/toast-store"
import { useAdminMe, useOps, useRunOpsJob } from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { toJobRow } from "@/lib/ops/format"
import type { OpsJobRow, OpsRunStage } from "@/types/components"

/**
 * The System/ops board state + the "Run now" flow state machine. Exposes the live ops
 * query, the derived job rows, and the reason → engine-action → run flow (step-up-gated,
 * replayed on a 403). A manual job run re-drives an engine worker — it moves no money
 * (§3.1). Extracted from the page so the orchestrator is pure composition.
 */
export function useOpsRun() {
  const { data, isLoading, isError, isSuccess, refetch } = useOps()
  const me = useAdminMe()
  const runJob = useRunOpsJob()
  const stepUp = useStepUpRetry()

  // The job whose "Run now" flow is open + which step of that flow is showing.
  const [active, setActive] = useState<{
    job: OpsJobRow
    stage: OpsRunStage
  } | null>(null)
  // The audited reason captured in the ReasonModal, replayed with the mutation.
  const [reason, setReason] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  function closeFlow() {
    setActive(null)
  }

  function openRun(job: OpsJobRow) {
    setActive({ job, stage: "reason" })
  }

  // Capture the audited reason → advance to the engine-action leg.
  function advanceToEngine(capturedReason: string) {
    if (!active) return
    setReason(capturedReason)
    setActive({ job: active.job, stage: "engine" })
  }

  // The engine-action CTA fires the REAL mutation. Step-up-gated: on a 403 the
  // StepUpDialog opens and replays on re-auth. A manual run re-drives an engine worker —
  // it moves no money (§3.1).
  function executeRun() {
    if (!active) return
    const job = active.job
    setLocalError(null)
    closeFlow()
    void (async () => {
      try {
        const completed = await stepUp.run(() =>
          runJob.mutateAsync({ id: job.id, input: { reason } }).then((res) => {
            pushToast(
              res.triggered
                ? `Run started · ${job.name}`
                : `${job.name} is not manually triggerable`,
              res.triggered ? "info" : "warn"
            )
          })
        )
        if (completed) setReason("")
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((done) => {
        if (done) setReason("")
      })
      .catch((error) => setLocalError(toErrorMessage(error)))
  }

  const jobs = (data?.jobs ?? []).map(toJobRow)
  const isEmpty =
    isSuccess &&
    data.providers.length === 0 &&
    data.webhookQueues.length === 0 &&
    data.jobs.length === 0

  return {
    data,
    isLoading,
    isError,
    isSuccess,
    isEmpty,
    refetch,
    me,
    stepUp,
    jobs,
    active,
    localError,
    openRun,
    closeFlow,
    advanceToEngine,
    executeRun,
    onStepUpSuccess,
  }
}
