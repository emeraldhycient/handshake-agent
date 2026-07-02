import { z } from "zod";

// Admin RECONCILIATION DTOs (Phase 6b, READ-ONLY) — the provider-vs-ledger break
// list + the reconciliation-cron status bar. A "break" is a detected discrepancy
// between what a provider settled (Blockradar on-chain / Flutterwave NGN) and what
// the double-entry ledger recorded. Breaks are PROJECTED on read from real rows
// (unresolved CompensationRecord drifts + stuck SettlementOutbox rows) — there is
// no persisted break entity yet, so nothing here is mutated (§3.1) and the
// resolve/accept/escalate/run-now WRITES are deferred to Phase 7.
//
// Over-credits are FLAGGED for human action, NEVER auto-debited (root §3.1): this
// surface only reads the discrepancy; remediation is engine-brokered elsewhere.
//
// Single source of truth shared by the API (response parsing) and web-admin.
// Amounts are byte-stable strings; timestamps are ISO. No PII crosses this
// boundary — breaks reference the offending transaction by opaque id only (§3.4).

// ── Break kind — the discrepancy class (selects the FE icon + phrasing) ─────────────
// - over_credit        — the ledger credited MORE than the provider confirmed.
// - missing_settlement — the provider settled but the matching ledger entry is absent.
// - amount_mismatch    — provider and ledger amounts diverge (e.g. fee rounding).
// - duplicate_credit   — the same provider credit posted to the ledger twice.
export const ReconBreakKindSchema = z.enum([
  "over_credit",
  "missing_settlement",
  "amount_mismatch",
  "duplicate_credit",
]);
export type ReconBreakKind = z.infer<typeof ReconBreakKindSchema>;

// ── Severity — mapped to the canonical status pill (high=danger/medium=warn/low=info) ─
export const ReconBreakSeveritySchema = z.enum(["high", "medium", "low"]);
export type ReconBreakSeverity = z.infer<typeof ReconBreakSeveritySchema>;

// ── Status — the break's disposition. Only `open` is producible on read today; the
// resolved/accepted/escalated outcomes are Phase-7 writes but modeled here so the
// contract is stable when they land. Currently every projected break is `open`.
export const ReconBreakStatusSchema = z.enum([
  "open",
  "resolved",
  "accepted",
  "escalated",
]);
export type ReconBreakStatus = z.infer<typeof ReconBreakStatusSchema>;

// ── One provider-vs-ledger break ─────────────────────────────────────────────────
// `transactionId` links to the offending transaction (the FE routes to its detail).
// `delta` is the signed provider-minus-ledger difference as a byte-stable string
// (e.g. "+50.00", "-185000.00"); `asset` is the delta's unit (USDT / TRX / NGN).
// `detail` is a human-readable, PII-free explanation the FE renders verbatim.
export const ReconBreakSchema = z.object({
  id: z.string(),
  kind: ReconBreakKindSchema,
  severity: ReconBreakSeveritySchema,
  transactionId: z.string(),
  asset: z.string(),
  delta: z.string(),
  detail: z.string(),
  status: ReconBreakStatusSchema,
  detectedAt: z.string(),
});
export type ReconBreak = z.infer<typeof ReconBreakSchema>;

export const ReconBreakListResponseSchema = z.object({
  items: z.array(ReconBreakSchema),
});
export type ReconBreakListResponse = z.infer<
  typeof ReconBreakListResponseSchema
>;

// ── Reconciliation-cron status bar ──────────────────────────────────────────────────
// The header status: when the reconciler last ran, when it is due next, whether it
// is enabled, and how many breaks are currently open. `lastRunAt` / `nextRunAt` are
// ISO or null (never run / not scheduled). `intervalSeconds` is the tick cadence.
// `enabled` mirrors the RECONCILIATION_CRON_ENABLED config flag.
export const ReconStatusSchema = z.object({
  enabled: z.boolean(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  intervalSeconds: z.number(),
  openBreakCount: z.number(),
});
export type ReconStatus = z.infer<typeof ReconStatusSchema>;
