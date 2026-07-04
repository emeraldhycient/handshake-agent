"use client"

/**
 * ReconRunHistoryPanel (Go-readiness #3) — the DURABLE reconciliation-run history +
 * break lifecycle, distinct from the ephemeral projected-break board above it. Lists
 * persisted runs (settlement-outbox cron re-drives + wallet-deposit reconciles);
 * expanding a run reveals its detected breaks; a break can be ACKNOWLEDGED (triaged)
 * or RESOLVED (closed) — each an annotation-only, step-up-gated, audited disposition
 * that moves no money (§3.1). Over-credits are surfaced for human action, never
 * auto-debited.
 *
 * Every disposition captures an audited reason (ReasonModal) then runs through the
 * shared step-up-then-retry flow (a 403 opens StepUpDialog and replays on re-auth);
 * on success the run list + the owning run detail are invalidated so the fresh
 * lifecycle state shows.
 */
import { useState } from "react"
import type { PersistedReconBreak, ReconRun } from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { formatDelta } from "@/lib/format"
import {
  useAcknowledgeReconRunBreak,
  useAdminMe,
  useReconRun,
  useReconRuns,
  useResolveReconRunBreak,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { ReasonModal } from "@/components/admin/flows"

type ActionKind = "acknowledge" | "resolve"

interface PendingAction {
  breakId: string
  kind: ActionKind
}

const RUN_TYPE_LABEL: Record<ReconRun["runType"], string> = {
  settlement_outbox: "Settlement outbox",
  wallet_deposit: "Wallet deposit",
}

const RUN_STATUS_VARIANT: Record<
  ReconRun["status"],
  "success" | "warn" | "danger"
> = {
  running: "warn",
  completed: "success",
  failed: "danger",
}

const BREAK_STATUS_VARIANT: Record<
  PersistedReconBreak["status"],
  "success" | "warn" | "info" | "neutral"
> = {
  detected: "warn",
  acknowledged: "info",
  resolved: "success",
  rejected: "neutral",
}

const BREAK_TYPE_LABEL: Record<PersistedReconBreak["breakType"], string> = {
  balance_mismatch: "Balance mismatch",
  over_credit: "Over-credit",
  settlement_failure: "Settlement failure",
}

/** A break is still actionable while it has not reached a terminal disposition. */
function isActionable(status: PersistedReconBreak["status"]): boolean {
  return status === "detected" || status === "acknowledged"
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function ReconRunHistoryPanel() {
  const runsQuery = useReconRuns()
  const me = useAdminMe()
  const ackMutation = useAcknowledgeReconRunBreak()
  const resolveMutation = useResolveReconRunBreak()
  const stepUp = useStepUpRetry()

  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  function openReason(breakId: string, kind: ActionKind) {
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
        setLocalError(errorMessage(error))
      }
    })()
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-bold text-ink">Run history</h2>
        <p className="mt-0.5 text-xs text-ink3">
          Durable reconciliation runs. Expand a run to triage its detected
          breaks — acknowledge or resolve (annotation-only, step-up-gated; never
          a debit).
        </p>
      </div>

      {runsQuery.isPending && (
        <div className="space-y-2" data-testid="recon-runs-loading">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {runsQuery.isError && (
        <p role="alert" className="text-[12px] font-semibold text-tdn">
          Couldn’t load run history. Try again.
        </p>
      )}

      {runsQuery.isSuccess && runsQuery.data.items.length === 0 && (
        <p className="text-xs text-ink3">
          No reconciliation runs recorded yet.
        </p>
      )}

      {runsQuery.isSuccess && runsQuery.data.items.length > 0 && (
        <ul className="divide-y divide-line">
          {runsQuery.data.items.map((run) => (
            <li key={run.id} className="py-3">
              <button
                type="button"
                aria-expanded={expanded === run.id}
                onClick={() =>
                  setExpanded((cur) => (cur === run.id ? null : run.id))
                }
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="flex items-center gap-2">
                  <Badge variant={RUN_STATUS_VARIANT[run.status]}>
                    {run.status}
                  </Badge>
                  <span className="text-sm font-semibold text-ink">
                    {RUN_TYPE_LABEL[run.runType]}
                  </span>
                </span>
                <span className="flex items-center gap-4 text-xs text-ink3">
                  <span>{run.totalChecked} checked</span>
                  <span
                    className={cn(
                      "font-semibold",
                      run.breaksDetected > 0 ? "text-tdn" : "text-ink3"
                    )}
                  >
                    {run.breaksDetected} break
                    {run.breaksDetected === 1 ? "" : "s"}
                  </span>
                  <span>{formatDate(run.startedAt)}</span>
                </span>
              </button>

              {expanded === run.id && (
                <RunBreaks runId={run.id} onAct={openReason} />
              )}
            </li>
          ))}
        </ul>
      )}

      <ReasonModal
        open={reasonOpen}
        onOpenChange={(o) => !o && setReasonOpen(false)}
        title={
          pending?.kind === "resolve"
            ? "Resolve reconciliation break"
            : "Acknowledge reconciliation break"
        }
        onContinue={(r, category) =>
          runDisposition(category ? `${category}: ${r}` : r)
        }
      />

      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />

      {localError && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
          {localError}
        </p>
      )}
    </div>
  )
}

interface RunBreaksProps {
  runId: string
  onAct: (breakId: string, kind: ActionKind) => void
}

/** The detected breaks for one expanded run (lazily fetched on expand). */
function RunBreaks({ runId, onAct }: RunBreaksProps) {
  const detail = useReconRun(runId)

  if (detail.isPending) {
    return (
      <Skeleton className="mt-3 h-10 w-full" data-testid="run-breaks-loading" />
    )
  }
  if (detail.isError) {
    return (
      <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
        Couldn’t load this run’s breaks.
      </p>
    )
  }
  if (detail.data.breaks.length === 0) {
    return (
      <p className="mt-3 text-xs text-ink3">No breaks detected in this run.</p>
    )
  }

  return (
    <ul className="mt-3 space-y-2 border-l-2 border-line pl-3">
      {detail.data.breaks.map((brk) => (
        <li
          key={brk.id}
          className="flex items-center justify-between gap-3 rounded-lg bg-card2 px-3 py-2"
        >
          <span className="flex items-center gap-2">
            <Badge variant={BREAK_STATUS_VARIANT[brk.status]}>
              {brk.status}
            </Badge>
            <span className="text-xs font-semibold text-ink">
              {BREAK_TYPE_LABEL[brk.breakType]}
            </span>
            <span className="font-mono text-xs text-ink3">
              {formatDelta(brk.delta, brk.currency)}
            </span>
          </span>
          {isActionable(brk.status) && (
            <span className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAct(brk.id, "acknowledge")}
              >
                Acknowledge
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => onAct(brk.id, "resolve")}
              >
                Resolve
              </Button>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
