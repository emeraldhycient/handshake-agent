"use client"

/**
 * OpsPage — the "System / ops" operator screen (design §6.29), a PIXEL reproduction of
 * `docs/design-ref/screens/Ops.html` (the `pOps` flag block), now wired to REAL data.
 *
 * Layout mirrors the markup 1:1 (`max-width:1300px` · `padding:26px 30px 60px`):
 *   • Header block — "System / ops" 24px/800 + the design's subtitle.
 *   • `grid-template-columns:repeat(5,1fr); gap:12px` — provider status tiles
 *     (radius 14, padding 14/15): a dot + name (12px/700) + latency (11px mono ink2) +
 *     status label (10.5px/700 in the health-toned text).
 *   • `grid-template-columns:1fr 1.2fr; gap:14px` — "Webhook queues" (mono name +
 *     depth/retries meta + status label) | "Background jobs & cron" (name +
 *     schedule/last meta + status pill + a "Run now" link).
 *
 * DATA (Phase 6b): the board is fetched from `GET /admin/ops` via `useOps()` — the
 * per-provider status (derived from SettlementOutbox dispatch history), the
 * webhook-ingest queue depths + retries, and the declared background-jobs / cron
 * registry with each job's last observable run. The FE composes the display labels
 * (latency "142ms", "Operational" / "Draining", relative "3m ago") from the raw
 * contract fields; colour is never the sole signal — the status word carries the state.
 *
 * The screen is read-only oversight — it moves no money (§3.1). The design's "Run now"
 * affordance is wired to the SAME shared flow modals an operational action opens:
 * reason (audit) → step-up (TOTP) → engine-action. Triggering a background job is
 * engine-brokered — never a raw side-effect from this surface — so the flow encodes
 * that invariant in the UI (the live run endpoint itself is a Phase-7 write).
 */
import { useState } from "react"

import type {
  MetricsRangeQuery,
  OpsJob,
  OpsProviderStatus,
  ServiceHealthMetrics,
  OpsWebhookQueue as OpsWebhookQueueDto,
} from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import { pushToast } from "@/lib/store/toast-store"
import {
  useAdminMe,
  useBackfillRun,
  useDashboardMetrics,
  useEnqueueBackfill,
  useOps,
  useRunOpsJob,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { EngineActionModal, ReasonModal } from "@/components/admin/flows"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  OpsHealth,
  OpsJobRow,
} from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

// ─── health → token mapping ─────────────────────────────────────────────────────────
// The design uses per-row raw colours (`p.dot` / `p.fg` / `w.fg` / `j.stBg` / `j.stFg`).
// Each maps onto the canonical status token pairs (§5): ok=success/green,
// warn=degraded/amber, down=failing/red. Colour is never the sole signal — the status
// word carries the state in text. The contract `OpsHealth` enum is identical to the FE
// `OpsHealth` presentation type, so a health value drives these token maps directly.

/** The dot / status-label text token for a health status. */
const HEALTH_TEXT: Record<OpsHealth, string> = {
  ok: "text-tok",
  warn: "text-twn",
  down: "text-tdn",
}

/** The dot background token for a health status. */
const HEALTH_DOT: Record<OpsHealth, string> = {
  ok: "bg-tok",
  warn: "bg-twn",
  down: "bg-tdn",
}

/** The job status-pill surface + text token pair for a health status. */
const HEALTH_PILL: Record<OpsHealth, string> = {
  ok: "bg-sok text-tok",
  warn: "bg-swn text-twn",
  down: "bg-sdn text-tdn",
}

// ─── contract → display mappers ───────────────────────────────────────────────────────

/** Provider status word from health (the design's "Operational" / "Degraded" label). */
const PROVIDER_STATUS_LABEL: Record<OpsHealth, string> = {
  ok: "Operational",
  warn: "Degraded",
  down: "Down",
}

/** Webhook-queue status word from health (the design's "Healthy" / "Draining" label). */
const QUEUE_STATUS_LABEL: Record<OpsHealth, string> = {
  ok: "Healthy",
  warn: "Draining",
  down: "Backed up",
}

/** Job status word from the run outcome (the design's status pill). */
const JOB_STATUS_LABEL: Record<OpsJob["status"], string> = {
  idle: "Idle",
  running: "Running",
  ok: "Healthy",
  failed: "Failed",
}

/** A latency figure → the mono "142ms" label, or an em dash when unobserved. */
function latencyLabel(lastLatencyMs: number | null): string {
  return lastLatencyMs === null ? "—" : `${lastLatencyMs}ms`
}

/** An ISO timestamp → a compact relative "3m ago" / "9h ago" label ("never" when null). */
function relativeLabel(iso: string | null): string {
  if (iso === null) return "never"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "never"
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Map a contract job onto the FE row shape the Run-now flow + status pill consume. */
function toJobRow(job: OpsJob): OpsJobRow {
  const last =
    job.status === "failed"
      ? `Failed ${relativeLabel(job.lastRunAt)}`
      : relativeLabel(job.lastRunAt)
  return {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    last,
    status: JOB_STATUS_LABEL[job.status],
    health: job.health,
  }
}

// ─── "Run now" engine-action payload ─────────────────────────────────────────────────
// Running a job is engine-brokered oversight — no funds move. The itemized effect +
// (empty) ledger preview demonstrate that the same validation + idempotency path the
// engine uses is what triggers the job; a real callsite would derive these from the job.
function jobEffect(job: OpsJobRow): EngineEffectRow[] {
  return [
    { k: "Job", v: job.name },
    { k: "Schedule", v: job.schedule },
    { k: "Last run", v: job.last },
    { k: "Trigger", v: "Manual · out-of-band run" },
  ]
}

// A manual job run writes no ledger entries — it is operational, not a money movement.
const NO_LEDGER: readonly EngineLedgerRow[] = []

// ─── sections ─────────────────────────────────────────────────────────────────────────

/** The 5-up provider status tiles (dot + name + latency + status). */
function ProviderTiles({ providers }: { providers: OpsProviderStatus[] }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {providers.map((provider) => (
        <div
          key={provider.key}
          className="rounded-[14px] border border-line bg-card px-[15px] py-[14px]"
        >
          <div className="mb-[7px] flex items-center gap-[7px]">
            <span
              className={cn("size-2 rounded-full", HEALTH_DOT[provider.health])}
              aria-hidden
            />
            <span className="text-xs font-bold text-ink">{provider.name}</span>
          </div>
          <div className="font-mono text-[11px] text-ink2 tabular-nums">
            {latencyLabel(provider.lastLatencyMs)}
          </div>
          <div
            className={cn(
              "mt-0.5 text-[10.5px] font-bold",
              HEALTH_TEXT[provider.health]
            )}
          >
            {PROVIDER_STATUS_LABEL[provider.health]}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Skeleton grid matching the 5-up provider tiles, for the loading branch. */
function ProviderTilesSkeleton() {
  return (
    <div
      className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      aria-busy="true"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[14px] border border-line bg-card px-[15px] py-[14px]"
        >
          <Skeleton className="mb-[7px] h-3.5 w-24" />
          <Skeleton className="h-[11px] w-12" />
          <Skeleton className="mt-1 h-2.5 w-16" />
        </div>
      ))}
    </div>
  )
}

/** Left panel — Webhook queues (mono name + depth/retries + status). */
function WebhookQueuesCard({ queues }: { queues: OpsWebhookQueueDto[] }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Webhook queues
      </div>
      {queues.map((queue) => (
        <div
          key={queue.key}
          className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
        >
          <div className="flex-1">
            <div className="font-mono text-xs font-semibold text-ink">
              {queue.key}
            </div>
            <div className="text-[10.5px] text-ink3">
              depth <span className="tabular-nums">{queue.depth}</span> ·
              retries <span className="tabular-nums">{queue.retries}</span>
            </div>
          </div>
          <span
            className={cn("text-[10.5px] font-bold", HEALTH_TEXT[queue.health])}
          >
            {QUEUE_STATUS_LABEL[queue.health]}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Right panel — Background jobs & cron (name + schedule/last + status pill + Run now).
 * "Run now" opens the shared reason → step-up → engine-action flow for its job.
 */
function BackgroundJobsCard({
  jobs,
  onRun,
}: {
  jobs: OpsJobRow[]
  onRun: (job: OpsJobRow) => void
}) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Background jobs &amp; cron
      </div>
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex items-center gap-[11px] border-b border-line2 py-[11px] last:border-b-0"
        >
          <div className="flex-1">
            <div className="text-[12.5px] font-bold text-ink">{job.name}</div>
            <div className="font-mono text-[10.5px] text-ink3">
              {job.schedule} · last {job.last}
            </div>
          </div>
          <span
            className={cn(
              "rounded-full px-[9px] py-0.5 text-[10.5px] font-bold",
              HEALTH_PILL[job.health]
            )}
          >
            {job.status}
          </span>
          <button
            type="button"
            onClick={() => onRun(job)}
            aria-label={`Run ${job.name} now`}
            className="text-[11.5px] font-bold text-tif transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Run now
          </button>
        </div>
      ))}
    </div>
  )
}

/** Skeleton card matching a queues / jobs panel, for the loading branch. */
function PanelSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]" aria-busy="true">
      <Skeleton className="mb-3 h-3.5 w-32" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
        >
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// ─── service-health card ──────────────────────────────────────────────────────────────
// Reuses the dashboard's `serviceHealth` block (per transactable service success/
// error rates over the default 30-day window). Status semantics follow the success
// rate; colour is NEVER the sole signal — an explicit status word sits alongside every
// tone. Read-only oversight — it moves no money (§3.1).

/** Empty range → the metrics service defaults to the last 30 days server-side. */
const DEFAULT_RANGE: MetricsRangeQuery = {}

/** Success-rate thresholds → the canonical health tone. */
const SERVICE_OK_FLOOR = 0.98
const SERVICE_WARN_FLOOR = 0.9

/** A 0–1 success rate → the health tone (≥98% ok, ≥90% warn, else down). */
function serviceHealth(successRate: number): OpsHealth {
  if (successRate >= SERVICE_OK_FLOOR) return "ok"
  if (successRate >= SERVICE_WARN_FLOOR) return "warn"
  return "down"
}

/** Explicit status word per tone (distinct from the provider/queue vocab). */
const SERVICE_STATUS_LABEL: Record<OpsHealth, string> = {
  ok: "Nominal",
  warn: "Elevated errors",
  down: "Failing",
}

/** A 0–1 rate → a one-decimal percentage label (0.99 → "99.0%"). */
function pctLabel(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/** One service-health row (name + success/error rate + status word + counts). */
function ServiceHealthRow({
  service,
}: {
  service: ServiceHealthMetrics["services"][number]
}) {
  const health = serviceHealth(service.successRate)
  const errorRate = Math.max(0, 1 - service.successRate)
  return (
    <div className="flex items-center gap-[11px] border-b border-line2 py-[11px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-bold text-ink">
          {service.service}
        </div>
        <div className="text-[10.5px] text-ink3 tabular-nums">
          <span className="text-tok">
            {service.completed.toLocaleString()} completed
          </span>{" "}
          ·{" "}
          <span className="text-tdn">
            {service.failed.toLocaleString()} failed
          </span>{" "}
          · <span>{pctLabel(errorRate)} errors</span>
        </div>
      </div>
      <div className="flex-none text-right">
        <div
          className={cn(
            "text-sm font-extrabold tabular-nums",
            HEALTH_TEXT[health]
          )}
        >
          {pctLabel(service.successRate)}
        </div>
        <div className={cn("text-[10px] font-bold", HEALTH_TEXT[health])}>
          {SERVICE_STATUS_LABEL[health]}
        </div>
      </div>
    </div>
  )
}

/**
 * Service-health card — reuses `useDashboardMetrics().serviceHealth`. Four async
 * branches (loading / error / empty / data). Its own query so it renders alongside
 * the ops board without coupling either fetch.
 */
function ServiceHealthCard() {
  const { data, isLoading, isError, isSuccess, refetch } =
    useDashboardMetrics(DEFAULT_RANGE)
  const services = data?.serviceHealth.services ?? []

  return (
    <div className="mt-[14px] rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Service health
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2.5" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <div className="text-center">
          <p className="text-[12.5px] font-bold text-tdn">
            Couldn&apos;t load service health
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 inline-flex h-8 items-center rounded-[9px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {isSuccess && services.length === 0 && (
        <p className="text-[12.5px] text-ink3">
          No service activity in the last 30 days.
        </p>
      )}

      {isSuccess && services.length > 0 && (
        <div>
          {services.map((service) => (
            <ServiceHealthRow key={service.service} service={service} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── wallet-backfill panel ──────────────────────────────────────────────────────────────
// Enqueues an async wallet-network backfill (§3.1 — provisions missing wallet-network
// rows for existing custody wallets; no money moves), then POLLS the run to a terminal
// state (completed / failed) showing live scanned/total progress. Four branches
// (idle / enqueuing / running / terminal).

/** A backfill run's status → the health tone driving the progress accent. */
const BACKFILL_HEALTH: Record<
  "queued" | "running" | "completed" | "failed",
  OpsHealth
> = {
  queued: "warn",
  running: "warn",
  completed: "ok",
  failed: "down",
}

/** A backfill run's status → the explicit status word. */
const BACKFILL_STATUS_LABEL: Record<
  "queued" | "running" | "completed" | "failed",
  string
> = {
  queued: "Queued",
  running: "Running",
  completed: "Backfill complete",
  failed: "Backfill failed",
}

function WalletBackfillPanel() {
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

// ─── page ─────────────────────────────────────────────────────────────────────────────

/** The stage the active "Run now" flow is currently showing. */
type RunStage = "reason" | "engine"

export function OpsPage() {
  const { data, isLoading, isError, isSuccess, refetch } = useOps()
  const me = useAdminMe()
  const runJob = useRunOpsJob()
  const stepUp = useStepUpRetry()

  // The job whose "Run now" flow is open + which step of that flow is showing.
  const [active, setActive] = useState<{
    job: OpsJobRow
    stage: RunStage
  } | null>(null)
  // The audited reason captured in the ReasonModal, replayed with the mutation.
  const [reason, setReason] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  function closeFlow() {
    setActive(null)
  }

  // The engine-action CTA fires the REAL mutation. It is step-up-gated: on a 403
  // (ADMIN_STEP_UP_REQUIRED) the StepUpDialog opens and replays on re-auth. A manual
  // run re-drives an engine worker — it moves no money (§3.1).
  function executeRun() {
    if (!active) return
    const job = active.job
    setLocalError(null)
    closeFlow()
    void (async () => {
      try {
        const completed = await stepUp.run(() =>
          runJob
            .mutateAsync({ id: job.id, input: { reason } })
            .then((res) => {
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
        setLocalError(errorMessage(error))
      }
    })()
  }

  const jobs = (data?.jobs ?? []).map(toJobRow)
  const isEmpty =
    isSuccess &&
    data.providers.length === 0 &&
    data.webhookQueues.length === 0 &&
    data.jobs.length === 0

  return (
    <div
      data-screen-label="System / ops"
      className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]"
    >
      {/* Header block */}
      <div className="mb-4">
        <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          System / ops
        </h1>
        <p className="mt-[5px] mb-0 text-[13.5px] text-ink2">
          Provider board, webhook queues, background jobs and error rates.
        </p>
      </div>

      {/* Loading — skeleton tiles + panels. */}
      {isLoading && (
        <>
          <ProviderTilesSkeleton />
          <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1fr_1.2fr]">
            <PanelSkeleton />
            <PanelSkeleton />
          </div>
        </>
      )}

      {/* Error — tokened inline error with a retry affordance. */}
      {isError && (
        <div className="rounded-2xl border border-line bg-card p-[40px] text-center">
          <p className="text-[13px] font-bold text-tdn">
            Couldn&apos;t load the ops board
          </p>
          <p className="mt-1 text-[12px] text-ink3">
            The provider / queue / job feed is unavailable right now.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 inline-flex h-8 items-center rounded-[9px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty — nothing registered (defensive; the registry is normally non-empty). */}
      {isEmpty && (
        <div className="rounded-2xl border border-line bg-card p-[50px] text-center text-[13px] text-ink3">
          No providers, queues, or jobs registered.
        </div>
      )}

      {/* Data. */}
      {isSuccess && !isEmpty && (
        <>
          <ProviderTiles providers={data.providers} />
          <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1fr_1.2fr]">
            <WebhookQueuesCard queues={data.webhookQueues} />
            <BackgroundJobsCard
              jobs={jobs}
              onRun={(job) => setActive({ job, stage: "reason" })}
            />
          </div>
        </>
      )}

      {/* Service-health + wallet-backfill sections — independent queries, each with
          their own four-branch handling, so they render regardless of the board state. */}
      <ServiceHealthCard />
      <WalletBackfillPanel />

      {/* ── "Run now" flow: reason (audit) → engine-action → the REAL mutation.
          The mutation is step-up-gated (StepUpDialog opens on a 403 + replays). A
          manual job run is engine-brokered oversight — no ledger entries, no money. */}
      {active && (
        <>
          <ReasonModal
            open={active.stage === "reason"}
            onOpenChange={(o) => !o && closeFlow()}
            title={`Run ${active.job.name} now`}
            onContinue={(r, category) => {
              setReason(category ? `${category}: ${r}` : r)
              setActive({ job: active.job, stage: "engine" })
            }}
          />
          <EngineActionModal
            open={active.stage === "engine"}
            onOpenChange={(o) => !o && closeFlow()}
            title={`Run ${active.job.name}`}
            effect={jobEffect(active.job)}
            ledger={[...NO_LEDGER]}
            idempotencyKey={`ops-run-${active.job.id}`}
            cta="Trigger via engine"
            onExecute={executeRun}
          />
        </>
      )}

      {/* Real step-up: opened when the run mutation 403s, replays on re-auth. */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((done) => {
              if (done) setReason("")
            })
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
