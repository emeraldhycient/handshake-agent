import { z } from "zod";

// Admin OPS DTOs (Phase 6b) — READ-ONLY operational board for the "System / ops"
// operator screen: the per-provider status board, the webhook-ingest queue depths +
// retry counts, and the background-jobs / cron registry (schedule + last observed run
// + status). These are point-in-time projections over SettlementOutbox and the
// declared cron/job registry. Nothing here moves money (§3.1); no PII crosses this
// boundary (system events only — never a user name or account number).
//
// Distinction from metrics-ops.dto: metrics-ops feeds the DASHBOARD's system-health
// tile / activity feed / open-compliance count. This Ops board is the dedicated
// "System / ops" page — the provider board, webhook queues, and cron registry.

// ─── Shared health token ─────────────────────────────────────────────────────────────

/**
 * A health status → the canonical status token pair (§5). `ok` = healthy (green),
 * `warn` = degraded / draining / backed-up (amber), `down` = failing / erroring (red).
 * Mirrors the FE `OpsHealth` presentation type so the row drives the dot / status-label
 * / pill colour tokens directly.
 */
export const OpsHealthEnum = z.enum(["ok", "warn", "down"]);
export type OpsHealth = z.infer<typeof OpsHealthEnum>;

// ─── Provider status board ───────────────────────────────────────────────────────────

/**
 * One provider's observed integration status, derived from the recent SettlementOutbox
 * dispatch history for the settlement types it serves:
 * - `ok`   — recent dispatches succeeded (or none observed).
 * - `warn` — some recent dispatches failed but not all (degraded).
 * - `down` — every recent dispatch failed.
 * `lastLatencyMs` is the most recent observed dispatch→completion duration in
 * milliseconds where both timestamps exist, else null — there is no synthetic health
 * probe, so a provider with no settlement source (email/WhatsApp/LLM) reports `ok` /
 * null rather than a fabricated latency figure. The FE composes the "142ms" /
 * "Operational" display strings from `lastLatencyMs` + `health`.
 */
export const OpsProviderStatusSchema = z.object({
  /** Stable provider key, e.g. "blockradar" | "flutterwave" | "resend" | "whatsapp" | "anthropic". */
  key: z.string(),
  /** Human display name, e.g. "Blockradar". */
  name: z.string(),
  health: OpsHealthEnum,
  /** Most recent observed dispatch→completion latency (ms), or null when unobserved. */
  lastLatencyMs: z.number().nullable(),
});
export type OpsProviderStatus = z.infer<typeof OpsProviderStatusSchema>;

// ─── Webhook-ingest queues ───────────────────────────────────────────────────────────

/**
 * One webhook-ingest queue's live depth + in-flight retry count, projected from the
 * SettlementOutbox rows for the settlement type that queue drains. `health` is derived
 * from the depth/retries (backed-up → down, draining → warn, else ok). The FE composes
 * the "depth N · retries M" meta + status label from these fields.
 */
export const OpsWebhookQueueSchema = z.object({
  /** The queue's mono identifier, e.g. "blockradar.deposit" | "whatsapp.inbound". */
  key: z.string(),
  /** Current queue depth (rows awaiting dispatch/verification). */
  depth: z.number().int().nonnegative(),
  /** In-flight retry count (sum of extra attempts across the pending rows). */
  retries: z.number().int().nonnegative(),
  health: OpsHealthEnum,
});
export type OpsWebhookQueue = z.infer<typeof OpsWebhookQueueSchema>;

// ─── Background-jobs / cron registry ─────────────────────────────────────────────────

/**
 * A background job's last-observed run outcome:
 * - `idle`    — registered but no observable run in the sampled window.
 * - `running` — currently executing.
 * - `ok`      — last observable run completed cleanly.
 * - `failed`  — last observable run errored.
 */
export const OpsJobStatusEnum = z.enum(["idle", "running", "ok", "failed"]);
export type OpsJobStatus = z.infer<typeof OpsJobStatusEnum>;

/**
 * One registered background job / cron. `schedule` is the declared cron expression
 * (a deploy-time constant), `lastRunAt` the most recent observable run timestamp (ISO,
 * or null when none observed), and `status` the outcome of that run. The FE composes
 * the "{schedule} · last {relative}" meta + status pill from these fields.
 */
export const OpsJobSchema = z.object({
  /** Stable job key + flow identifier, e.g. "settlement-reconciliation". */
  id: z.string(),
  /** Display name, e.g. "Reconciliation sweep". */
  name: z.string(),
  /** Declared cron expression / cadence, e.g. "*\/2 * * * *". */
  schedule: z.string(),
  /** ISO-8601 timestamp of the most recent observable run, or null when none. */
  lastRunAt: z.string().nullable(),
  status: OpsJobStatusEnum,
  health: OpsHealthEnum,
});
export type OpsJob = z.infer<typeof OpsJobSchema>;

// ─── Composite ops board ─────────────────────────────────────────────────────────────

/**
 * The composite "System / ops" board payload — the provider status board, the
 * webhook-ingest queues, and the background-jobs / cron registry — in one round-trip.
 * READ-ONLY; nothing here moves money (§3.1). "Run now" (triggering a job) is a
 * Phase-7 engine-brokered write, not part of this read.
 */
export const OpsBoardSchema = z.object({
  providers: z.array(OpsProviderStatusSchema),
  webhookQueues: z.array(OpsWebhookQueueSchema),
  jobs: z.array(OpsJobSchema),
});
export type OpsBoard = z.infer<typeof OpsBoardSchema>;
