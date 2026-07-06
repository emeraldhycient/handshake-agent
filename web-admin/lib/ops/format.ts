import type { OpsJob } from "@handshake-agent/contracts"

import {
  JOB_STATUS_LABEL,
  SERVICE_OK_FLOOR,
  SERVICE_WARN_FLOOR,
} from "@/constants/ops"
import type { EngineEffectRow, OpsHealth, OpsJobRow } from "@/types/components"

/** A latency figure → the mono "142ms" label, or an em dash when unobserved. */
export function latencyLabel(lastLatencyMs: number | null): string {
  return lastLatencyMs === null ? "—" : `${lastLatencyMs}ms`
}

/** An ISO timestamp → a compact relative "3m ago" / "9h ago" label ("never" when null). */
export function relativeLabel(iso: string | null): string {
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
export function toJobRow(job: OpsJob): OpsJobRow {
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

/**
 * The "Run now" engine-action effect preview. Running a job is engine-brokered
 * oversight — no funds move; the itemized effect demonstrates the same validation +
 * idempotency path the engine uses to trigger the job.
 */
export function jobEffect(job: OpsJobRow): EngineEffectRow[] {
  return [
    { k: "Job", v: job.name },
    { k: "Schedule", v: job.schedule },
    { k: "Last run", v: job.last },
    { k: "Trigger", v: "Manual · out-of-band run" },
  ]
}

/** A 0–1 success rate → the health tone (≥98% ok, ≥90% warn, else down). */
export function serviceHealth(successRate: number): OpsHealth {
  if (successRate >= SERVICE_OK_FLOOR) return "ok"
  if (successRate >= SERVICE_WARN_FLOOR) return "warn"
  return "down"
}

/** A 0–1 rate → a one-decimal percentage label (0.99 → "99.0%"). */
export function pctLabel(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}
