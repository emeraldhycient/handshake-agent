"use client"

/**
 * OpsPage — the "System / ops" operator screen (design §6.29), a PIXEL reproduction of
 * `docs/design-ref/screens/Ops.html` (the `pOps` flag block).
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
 * DESIGN-ONLY (per the reproduction goal): logic.js does NOT expose this view method,
 * so every tile / queue / job is the design's own representative sample content
 * (module-level consts — no TanStack Query / no fetching), shaped exactly like the
 * markup + SPEC §6.29 + the seed() provider/cron shapes. Real-data reintegration is a
 * separate later step.
 *
 * The screen is read-only oversight — it moves no money (§3.1). The design's "Run now"
 * affordance is wired to the SAME shared flow modals an operational action opens:
 * reason (audit) → step-up (TOTP) → engine-action. Triggering a background job is
 * engine-brokered — never a raw side-effect from this surface — so the flow encodes
 * that invariant in the UI even though there is no live endpoint yet.
 */
import { useState } from "react"

import { cn } from "@/lib/utils"
import { pushToast } from "@/lib/store/toast-store"
import {
  EngineActionModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  OpsHealth,
  OpsJobRow,
  OpsProviderTile,
  OpsWebhookQueue,
} from "@/types/components"

// ─── health → token mapping ─────────────────────────────────────────────────────────
// The design uses per-row raw colours (`p.dot` / `p.fg` / `w.fg` / `j.stBg` / `j.stFg`).
// Each maps onto the canonical status token pairs (§5): ok=success/green,
// warn=degraded/amber, down=failing/red. Colour is never the sole signal — the status
// word carries the state in text.

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

// ─── design-faithful sample content (no ops endpoint yet) ───────────────────────────

// The five providers mirror the design's seed provider board (docs/design-ref/logic.js
// `providers`, line 139): Blockradar, Flutterwave (degraded), Resend, WhatsApp Cloud
// API, Anthropic — with representative probe latencies.
const PROVIDER_TILES: readonly OpsProviderTile[] = [
  { name: "Blockradar", latency: "120ms", status: "Operational", health: "ok" },
  {
    name: "Flutterwave",
    latency: "890ms",
    status: "Degraded",
    health: "warn",
  },
  { name: "Resend", latency: "70ms", status: "Operational", health: "ok" },
  {
    name: "WhatsApp Cloud",
    latency: "210ms",
    status: "Operational",
    health: "ok",
  },
  { name: "Anthropic", latency: "640ms", status: "Operational", health: "ok" },
]

// Representative webhook-ingest queues, shaped exactly like the markup (mono name +
// "depth · retries" meta + a health-toned status word).
const WEBHOOK_QUEUES: readonly OpsWebhookQueue[] = [
  {
    name: "blockradar.deposit",
    depth: 0,
    retries: 0,
    status: "Healthy",
    health: "ok",
  },
  {
    name: "blockradar.withdraw",
    depth: 3,
    retries: 1,
    status: "Draining",
    health: "warn",
  },
  {
    name: "flutterwave.collection",
    depth: 0,
    retries: 0,
    status: "Healthy",
    health: "ok",
  },
  {
    name: "whatsapp.inbound",
    depth: 12,
    retries: 4,
    status: "Backed up",
    health: "down",
  },
]

// Representative cron / background jobs, mirroring the seed() maintenance cadence
// (reconciliation, child-address sweep, sanctions refresh, statement-link regen).
const JOB_ROWS: readonly OpsJobRow[] = [
  {
    id: "reconciliation-sweep",
    name: "Reconciliation sweep",
    schedule: "*/15 * * * *",
    last: "3m ago",
    status: "Healthy",
    health: "ok",
  },
  {
    id: "child-address-sweep",
    name: "Child-address sweep",
    schedule: "0 * * * *",
    last: "22m ago",
    status: "Healthy",
    health: "ok",
  },
  {
    id: "sanctions-refresh",
    name: "Sanctions list refresh",
    schedule: "0 3 * * *",
    last: "9h ago",
    status: "Healthy",
    health: "ok",
  },
  {
    id: "statement-link-regen",
    name: "Statement-link regen",
    schedule: "0 0 * * *",
    last: "Failed 1h ago",
    status: "Failed",
    health: "down",
  },
]

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
function ProviderTiles() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {PROVIDER_TILES.map((provider) => (
        <div
          key={provider.name}
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
            {provider.latency}
          </div>
          <div
            className={cn(
              "mt-0.5 text-[10.5px] font-bold",
              HEALTH_TEXT[provider.health]
            )}
          >
            {provider.status}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Left panel — Webhook queues (mono name + depth/retries + status). */
function WebhookQueuesCard() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Webhook queues
      </div>
      {WEBHOOK_QUEUES.map((queue) => (
        <div
          key={queue.name}
          className="flex items-center gap-[11px] border-b border-line2 py-2.5 last:border-b-0"
        >
          <div className="flex-1">
            <div className="font-mono text-xs font-semibold text-ink">
              {queue.name}
            </div>
            <div className="text-[10.5px] text-ink3">
              depth <span className="tabular-nums">{queue.depth}</span> ·
              retries <span className="tabular-nums">{queue.retries}</span>
            </div>
          </div>
          <span
            className={cn("text-[10.5px] font-bold", HEALTH_TEXT[queue.health])}
          >
            {queue.status}
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
function BackgroundJobsCard({ onRun }: { onRun: (job: OpsJobRow) => void }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Background jobs &amp; cron
      </div>
      {JOB_ROWS.map((job) => (
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

// ─── page ─────────────────────────────────────────────────────────────────────────────

/** The stage the active "Run now" flow is currently showing. */
type RunStage = "reason" | "stepup" | "engine"

export function OpsPage() {
  // The job whose "Run now" flow is open + which step of that flow is showing.
  const [active, setActive] = useState<{
    job: OpsJobRow
    stage: RunStage
  } | null>(null)

  function closeFlow() {
    setActive(null)
  }

  // Engine confirmed the manual run — surface a "queued" toast (the design's
  // verify expects this feedback), then dismiss the flow.
  function executeRun() {
    if (active) pushToast(`Run started · ${active.job.name}`, "info")
    closeFlow()
  }

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

      <ProviderTiles />

      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1fr_1.2fr]">
        <WebhookQueuesCard />
        <BackgroundJobsCard
          onRun={(job) => setActive({ job, stage: "reason" })}
        />
      </div>

      {/* ── "Run now" flow (shared): reason (audit) → step-up (TOTP) → engine-action.
          A manual job run is engine-brokered oversight — no ledger entries, no money. */}
      {active && (
        <>
          <ReasonModal
            open={active.stage === "reason"}
            onOpenChange={(o) => !o && closeFlow()}
            title={`Run ${active.job.name} now`}
            onContinue={() => setActive({ job: active.job, stage: "stepup" })}
          />
          <StepUpModal
            open={active.stage === "stepup"}
            onOpenChange={(o) => !o && closeFlow()}
            title={`run ${active.job.name}`}
            onComplete={() => setActive({ job: active.job, stage: "engine" })}
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
    </div>
  )
}
