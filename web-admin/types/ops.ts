/** System / ops page (§6.29). */

// ─── System / ops page (design §6.29) ────────────────────────────────────────
// Three sections: a 5-up provider status tile grid, a "Webhook queues" list, and a
// "Background jobs & cron" list. There is NO operational-status endpoint yet, so the
// whole screen is design-faithful representative content shaped exactly like the
// design. It is read-only oversight — nothing here moves money (§3.1). The "Run now"
// affordance wires to the SAME shared flow modals the design opens for an operational
// action: reason (audit) → step-up (TOTP) → engine-action. Triggering a background job
// is engine-brokered — never a raw side-effect from this surface — so the flow encodes
// that invariant in the UI even though there is no live endpoint yet.

/**
 * A health status → the canonical status token pair (§5). `ok` = healthy (green),
 * `warn` = degraded/backed-up (amber), `down` = failing/erroring (red).
 */
export type OpsHealth = "ok" | "warn" | "down"

/** One "Webhook queues" row (mono name + depth/retries meta + status label). */
export interface OpsWebhookQueue {
  /** The queue's mono identifier (e.g. "blockradar.deposit"). */
  name: string
  /** Current queue depth (tabular-nums). */
  depth: number
  /** In-flight retry count (tabular-nums). */
  retries: number
  /** Short status label in the health-toned text (e.g. "Draining"). */
  status: string
  /** Drives the status-label colour token. */
  health: OpsHealth
}

/** One "Background jobs & cron" row (name + schedule/last meta + status pill + Run now). */
export interface OpsJobRow {
  /** Stable key + flow identifier (e.g. "reconciliation-sweep"). */
  id: string
  /** The job's display name (e.g. "Reconciliation sweep"). */
  name: string
  /** Cron-expression / cadence label (mono). */
  schedule: string
  /** Relative "last ran" label (mono; e.g. "3m ago"). */
  last: string
  /** Short status label rendered inside the status pill (e.g. "Healthy"). */
  status: string
  /** Drives the status-pill surface + text token pair. */
  health: OpsHealth
}

/** The stage the active "Run now" flow is showing. */
export type OpsRunStage = "reason" | "engine"

/** A wallet-backfill run's lifecycle status. */
export type BackfillStatus = "queued" | "running" | "completed" | "failed"

/** The 5-up provider status tiles (contract-sourced). */
export interface ProviderTilesProps {
  providers: import("@handshake-agent/contracts").OpsProviderStatus[]
}

/** The webhook-queues panel (contract-sourced rows). */
export interface WebhookQueuesCardProps {
  queues: import("@handshake-agent/contracts").OpsWebhookQueue[]
}

/** The background-jobs panel — each job carries a step-up-gated "Run now". */
export interface BackgroundJobsCardProps {
  jobs: OpsJobRow[]
  onRun: (job: OpsJobRow) => void
}

/** One service-health row (success/error rate + status word). */
export interface ServiceHealthRowProps {
  service: import("@handshake-agent/contracts").ServiceHealthMetrics["services"][number]
}

/** The shared "Run now" flow modals (reason → engine-action) for the active job. */
export interface OpsRunFlowProps {
  job: OpsJobRow
  stage: OpsRunStage
  onClose: () => void
  /** Reason (audit) captured → advance to the engine-action leg. */
  onContinue: (reason: string) => void
  onExecute: () => void
}
