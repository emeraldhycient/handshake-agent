/**
 * System/ops constants (design §6.29 `Ops.html`). Health → token maps and the
 * per-context status vocabularies. Colour is never the sole signal — every tone is
 * paired with an explicit status word.
 */
import type { MetricsRangeQuery, OpsJob } from "@handshake-agent/contracts"
import type {
  BackfillStatus,
  EngineLedgerRow,
  OpsHealth,
} from "@/types/components"

/** The dot / status-label text token for a health status. */
export const HEALTH_TEXT: Record<OpsHealth, string> = {
  ok: "text-tok",
  warn: "text-twn",
  down: "text-tdn",
}

/** The dot background token for a health status. */
export const HEALTH_DOT: Record<OpsHealth, string> = {
  ok: "bg-tok",
  warn: "bg-twn",
  down: "bg-tdn",
}

/** The job status-pill surface + text token pair for a health status. */
export const HEALTH_PILL: Record<OpsHealth, string> = {
  ok: "bg-sok text-tok",
  warn: "bg-swn text-twn",
  down: "bg-sdn text-tdn",
}

/** Provider status word from health (the design's "Operational" / "Degraded" label). */
export const PROVIDER_STATUS_LABEL: Record<OpsHealth, string> = {
  ok: "Operational",
  warn: "Degraded",
  down: "Down",
}

/** Webhook-queue status word from health (the design's "Healthy" / "Draining" label). */
export const QUEUE_STATUS_LABEL: Record<OpsHealth, string> = {
  ok: "Healthy",
  warn: "Draining",
  down: "Backed up",
}

/** Job status word from the run outcome (the design's status pill). */
export const JOB_STATUS_LABEL: Record<OpsJob["status"], string> = {
  idle: "Idle",
  running: "Running",
  ok: "Healthy",
  failed: "Failed",
}

/** Explicit service-health status word per tone (distinct from provider/queue vocab). */
export const SERVICE_STATUS_LABEL: Record<OpsHealth, string> = {
  ok: "Nominal",
  warn: "Elevated errors",
  down: "Failing",
}

/** Success-rate thresholds → the canonical health tone. */
export const SERVICE_OK_FLOOR = 0.98
export const SERVICE_WARN_FLOOR = 0.9

/** Empty range → the metrics service defaults to the last 30 days server-side. */
export const DEFAULT_RANGE: MetricsRangeQuery = {}

/** A manual job run writes no ledger entries — it is operational, not a money movement. */
export const NO_LEDGER: readonly EngineLedgerRow[] = []

/** A backfill run's status → the health tone driving the progress accent. */
export const BACKFILL_HEALTH: Record<BackfillStatus, OpsHealth> = {
  queued: "warn",
  running: "warn",
  completed: "ok",
  failed: "down",
}

/** A backfill run's status → the explicit status word. */
export const BACKFILL_STATUS_LABEL: Record<BackfillStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Backfill complete",
  failed: "Backfill failed",
}
