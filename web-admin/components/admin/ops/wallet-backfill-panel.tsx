"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import { useBackfillRun, useEnqueueBackfill } from "@/lib/query/hooks"
import { ApiError } from "@/lib/api/client"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  BACKFILL_HEALTH,
  BACKFILL_STATUS_LABEL,
  HEALTH_TEXT,
} from "@/constants/ops"

/**
 * Enqueues an async wallet-network backfill (§3.1 — provisions missing wallet-network
 * rows for existing custody wallets; no money moves), then POLLS the run to a terminal
 * state showing live scanned/total progress. Four branches (idle / enqueuing / running
 * / terminal). Owns its own transient form + run state.
 */
export function WalletBackfillPanel() {
  const enqueue = useEnqueueBackfill()
  const [runId, setRunId] = useState<string | null>(null)
  const run = useBackfillRun(runId, { poll: true })

  // Transient form state (UI state — a controlled dry-run toggle + batch size).
  const [dryRun, setDryRun] = useState(false)
  const [batchSizeText, setBatchSizeText] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const isEnqueuing = enqueue.isPending
  const isRunning =
    run.data?.status === "queued" || run.data?.status === "running"

  function start() {
    setLocalError(null)
    const trimmed = batchSizeText.trim()
    const parsed = trimmed === "" ? undefined : Number(trimmed)
    const batchSize =
      parsed !== undefined && Number.isInteger(parsed) && parsed > 0
        ? parsed
        : undefined
    void enqueue
      .mutateAsync({
        ...(dryRun ? { dryRun: true } : {}),
        ...(batchSize !== undefined ? { batchSize } : {}),
      })
      .then((res) => setRunId(res.runId))
      .catch((error) => {
        if (error instanceof ApiError) setLocalError(error.message)
        else if (error instanceof Error) setLocalError(error.message)
        else setLocalError("Failed to enqueue backfill")
      })
  }

  const status = run.data?.status
  const failureCount = run.data?.failures.length ?? 0

  return (
    <div className="mt-[14px] rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-1 text-[13px] font-extrabold text-ink">
        Wallet-network backfill
      </div>
      <p className="mb-3 text-[11.5px] text-ink3">
        Provision missing wallet-network rows for existing custody wallets. No
        money moves.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-2 text-[12px] font-semibold text-ink2">
          <Switch
            checked={dryRun}
            onCheckedChange={setDryRun}
            aria-label="Dry run"
            disabled={isEnqueuing || isRunning}
          />
          Dry run
        </label>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-ink2">
          Batch size
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={batchSizeText}
            onChange={(e) => setBatchSizeText(e.target.value)}
            placeholder="100"
            aria-label="Batch size"
            disabled={isEnqueuing || isRunning}
            className="h-8 w-24 text-[12px]"
          />
        </label>
        <button
          type="button"
          onClick={start}
          disabled={isEnqueuing || isRunning}
          className="inline-flex h-8 items-center rounded-[9px] bg-ink px-3.5 text-[12px] font-bold text-bg transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          {isEnqueuing ? "Enqueuing…" : "Backfill wallet networks"}
        </button>
      </div>

      {/* Enqueue-error branch. */}
      {localError && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
          {localError}
        </p>
      )}

      {/* Live run branch (loading/running → terminal). */}
      {runId && (
        <div className="mt-4 rounded-[12px] border border-line2 bg-card2 px-4 py-3">
          {run.isLoading && !run.data && (
            <div aria-busy="true">
              <Skeleton className="h-4 w-40" />
            </div>
          )}
          {run.isError && (
            <p className="text-[12px] font-bold text-tdn">
              Couldn&apos;t read the backfill run
            </p>
          )}
          {status && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div
                  className={cn(
                    "text-[12.5px] font-bold",
                    HEALTH_TEXT[BACKFILL_HEALTH[status]]
                  )}
                >
                  {BACKFILL_STATUS_LABEL[status]}
                </div>
                <div className="text-[10.5px] text-ink3 tabular-nums">
                  {(run.data?.scannedUsers ?? 0).toLocaleString()} /{" "}
                  {(run.data?.totalUsers ?? 0).toLocaleString()} scanned
                  {failureCount > 0 && (
                    <span className="text-tdn">
                      {" · "}
                      {failureCount.toLocaleString()} failure
                      {failureCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
              {isRunning && (
                <span
                  className="size-2 animate-pulse rounded-full bg-twn"
                  aria-hidden
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
