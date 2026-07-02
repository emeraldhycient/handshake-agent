import { z } from "zod";

// Admin metrics-OPS DTOs (Phase 6b) — READ-ONLY operational-health signals for the
// operator dashboard's System-health card, Live-activity feed, and Open-compliance
// tile. These are point-in-time projections over SettlementOutbox / CompensationRecord
// / Transaction / AuditLog / ComplianceEvent. Nothing here moves money (§3.1); PII is
// kept out entirely (no last-4 needed — these are system events, not user identity).

// ─── System health ──────────────────────────────────────────────────────────────────

/**
 * The status of one external provider integration, derived from the recent
 * SettlementOutbox dispatch history for the settlement types it serves:
 * - `ok`      — recent dispatches succeeded (or none observed).
 * - `degraded`— some recent dispatches failed but not all.
 * - `down`    — every recent dispatch failed.
 * `lastLatencyMs` is the most recent dispatch→completion duration in milliseconds
 * where both timestamps exist, else null (there is no synthetic health probe — we
 * report only observed latency, never a fabricated figure).
 */
export const ProviderStatusEnum = z.enum(["ok", "degraded", "down"]);
export type ProviderStatus = z.infer<typeof ProviderStatusEnum>;

export const ProviderHealthSchema = z.object({
  /** Stable provider key, e.g. "blockradar" | "flutterwave" | "resend" | "whatsapp" | "anthropic". */
  key: z.string(),
  /** Human display name, e.g. "Blockradar". */
  name: z.string(),
  /** Short capability note, e.g. "Custodial WaaS · TRON". */
  note: z.string(),
  status: ProviderStatusEnum,
  /** Most recent observed dispatch→completion latency (ms), or null when unobserved. */
  lastLatencyMs: z.number().nullable(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

/**
 * The System-health card payload: per-provider status rows, the pending
 * webhook/settlement queue depth, and the count of unresolved reconciliation
 * drifts (pending/approved compensations not yet issued).
 */
export const SystemHealthSchema = z.object({
  providers: z.array(ProviderHealthSchema),
  /** SettlementOutbox rows awaiting dispatch/verification (pending+enqueued+in_progress). */
  webhookQueueDepth: z.number(),
  /** Unresolved CompensationRecord rows (a reconciliation drift not yet settled). */
  reconDriftCount: z.number(),
});
export type SystemHealth = z.infer<typeof SystemHealthSchema>;

// ─── Live activity feed ───────────────────────────────────────────────────────────

/**
 * The kind of platform event a feed row represents — a closed vocabulary the FE
 * maps to an icon/tint. Drawn from real rows: settled/failed transactions,
 * KYC approvals + config changes (AuditLog), and engine sweeps/refunds
 * (CompensationRecord).
 */
export const ActivityKindEnum = z.enum([
  "settled",
  "kyc_approved",
  "config_change",
  "failed",
  "sweep",
  "refund",
]);
export type ActivityKind = z.infer<typeof ActivityKindEnum>;

/**
 * One row of the live-activity feed. `title` + `meta` are pre-composed display
 * strings (the FE renders them verbatim); `at` is the event timestamp. No PII —
 * subjects are referenced by opaque id/ref, never by name or account number.
 */
export const ActivityEventSchema = z.object({
  id: z.string(),
  kind: ActivityKindEnum,
  /** Headline line, e.g. "Buy settled" or "KYC approved". */
  title: z.string(),
  /** Secondary mono line, e.g. "tx_80231 · 120.00 USDT" (opaque refs only). */
  meta: z.string(),
  /** ISO-8601 timestamp of the event. */
  at: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

// ─── Open compliance cases ──────────────────────────────────────────────────────────

/**
 * The count of open (flagged + under_review) compliance cases — the dashboard
 * "Open compliance cases" tile. A single scalar; the queue itself is served by the
 * compliance console endpoint.
 */
export const OpenComplianceSchema = z.object({
  openCases: z.number(),
});
export type OpenCompliance = z.infer<typeof OpenComplianceSchema>;

// ─── Composite ops payload ──────────────────────────────────────────────────────────

/**
 * The composite metrics-ops payload for the operator dashboard's three
 * still-mock panels — system health, the activity feed, and the open-compliance
 * count — in one round-trip. READ-ONLY; nothing here moves money (§3.1).
 */
export const MetricsOpsSchema = z.object({
  systemHealth: SystemHealthSchema,
  activityFeed: z.array(ActivityEventSchema),
  compliance: OpenComplianceSchema,
});
export type MetricsOps = z.infer<typeof MetricsOpsSchema>;
