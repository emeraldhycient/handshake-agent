"use client"

import { useMemo, useRef, useState } from "react"

import {
  useAcceptReconBreak,
  useAdminMe,
  useEscalateReconBreak,
  useReconBreaks,
  useReconStatus,
  useResolveReconBreak,
  useRunOpsJob,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { RECONCILIATION_JOB_ID } from "@/constants/reconciliation"
import type {
  ReconBreakResolution,
  ReconBreakView,
  ReconFlowStep,
} from "@/types/components"

/**
 * The Reconciliation-page funds-safety state machine (Phases 6b–9): the live break +
 * cron queries, the disposition/run mutations, the flow-step state, and the step-up
 * retry that replays a 403'd disposition or reconciler run. Nothing here moves money
 * (§3.1) — resolve is engine-brokered, accept is a no-debit disposition, escalate opens
 * a case, and the reconciler re-drives an engine worker. Extracted from the page so the
 * orchestrator is pure composition; every branch stays covered by the page test.
 */
export function useReconDispositions() {
  const breaksQuery = useReconBreaks()
  const statusQuery = useReconStatus()
  const me = useAdminMe()
  const resolveBreak = useResolveReconBreak()
  const acceptBreak = useAcceptReconBreak()
  const escalateBreak = useEscalateReconBreak()
  const runJob = useRunOpsJob()
  const stepUp = useStepUpRetry()

  // "Run now" reason (audit) leg — open while capturing the operator's justification
  // before the real settlement-reconciliation run fires. A boolean, not a break id.
  const [runReasonOpen, setRunReasonOpen] = useState(false)

  // Optimistic outcomes keyed by break id — reflect the disposition in the closed-card
  // footer immediately; the query invalidation then re-resolves the authoritative list.
  const [localOutcomes, setLocalOutcomes] = useState<
    Record<string, ReconBreakResolution>
  >({})
  // The break whose flow is currently open + which step of that flow is showing.
  const [active, setActive] = useState<{
    id: string
    flow: ReconFlowStep
  } | null>(null)
  // The audited reason captured before resolve/accept, replayed with the mutation.
  const [reason, setReason] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)
  // The disposition awaiting a step-up retry — re-marked locally on retry success.
  const pendingDisposition = useRef<{
    id: string
    resolution: ReconBreakResolution
  } | null>(null)

  const breaks: ReconBreakView[] = useMemo(
    () =>
      (breaksQuery.data?.items ?? []).map((b) => ({
        ...b,
        localResolution: localOutcomes[b.id],
      })),
    [breaksQuery.data, localOutcomes]
  )

  // Prefer the server's open-break count; fall back to the loaded list while it settles.
  const openCount =
    statusQuery.data?.openBreakCount ??
    breaks.filter((b) => b.localResolution === undefined).length

  const activeBreak = active
    ? (breaks.find((b) => b.id === active.id) ?? null)
    : null

  function closeFlow() {
    setActive(null)
  }

  function openEscalate(id: string) {
    setActive({ id, flow: { kind: "escalate" } })
  }
  function openAccept(id: string) {
    setActive({ id, flow: { kind: "accept", stage: "reason" } })
  }
  function openResolve(id: string) {
    setActive({ id, flow: { kind: "resolve", stage: "reason" } })
  }

  function advanceFlow(flow: ReconFlowStep) {
    if (active) setActive({ id: active.id, flow })
  }

  // The real mutation for a given disposition (mirrors the endpoint shapes). RESOLVE is
  // engine-brokered (re-drives settlement); ACCEPT is a no-debit disposition; ESCALATE
  // opens a compliance case — none moves money here (§3.1).
  function dispositionMutation(
    id: string,
    resolution: ReconBreakResolution,
    capturedReason: string
  ): Promise<unknown> {
    switch (resolution) {
      case "resolved":
        return resolveBreak.mutateAsync({
          id,
          input: { reason: capturedReason },
        })
      case "accepted":
        return acceptBreak.mutateAsync({
          id,
          input: { reason: capturedReason },
        })
      case "escalated":
        return escalateBreak.mutateAsync({ id, reason: capturedReason })
    }
  }

  // Run a real disposition mutation via step-up-retry. On a 403 the StepUpDialog opens
  // and replays on re-auth; on success the break is marked locally + the query
  // invalidation re-resolves the list.
  function runDisposition(
    id: string,
    resolution: ReconBreakResolution,
    capturedReason: string
  ) {
    setLocalError(null)
    closeFlow()
    pendingDisposition.current = { id, resolution }
    void (async () => {
      try {
        const completed = await stepUp.run(() =>
          dispositionMutation(id, resolution, capturedReason).then(
            () => undefined
          )
        )
        if (completed) {
          setLocalOutcomes((prev) => ({ ...prev, [id]: resolution }))
          setReason("")
          pendingDisposition.current = null
        }
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

  // Trigger a real manual run of the settlement-reconciliation job with the audited
  // reason. Step-up-gated; the reconciler re-drives an engine worker — it moves no money
  // (§3.1). On success the live queries refetch so the freshest break set + timeline show.
  function triggerRun(capturedReason: string) {
    setLocalError(null)
    setRunReasonOpen(false)
    pendingDisposition.current = null
    void (async () => {
      try {
        const completed = await stepUp.run(() =>
          runJob
            .mutateAsync({
              id: RECONCILIATION_JOB_ID,
              input: { reason: capturedReason },
            })
            .then(() => undefined)
        )
        if (completed) {
          void breaksQuery.refetch()
          void statusQuery.refetch()
        }
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

  // Replay the 403'd action after re-auth: a disposition marks the break locally; a run
  // (no pending disposition) refetches the live queries.
  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((done) => {
        if (!done) return
        const pending = pendingDisposition.current
        if (pending) {
          setLocalOutcomes((prev) => ({
            ...prev,
            [pending.id]: pending.resolution,
          }))
          setReason("")
          pendingDisposition.current = null
        } else {
          void breaksQuery.refetch()
          void statusQuery.refetch()
        }
      })
      .catch((error) => setLocalError(toErrorMessage(error)))
  }

  return {
    breaksQuery,
    statusQuery,
    me,
    stepUp,
    breaks,
    openCount,
    active,
    activeBreak,
    reason,
    localError,
    runReasonOpen,
    setRunReasonOpen,
    closeFlow,
    openEscalate,
    openAccept,
    openResolve,
    advanceFlow,
    captureReason: setReason,
    runDisposition,
    triggerRun,
    onStepUpSuccess,
  }
}
