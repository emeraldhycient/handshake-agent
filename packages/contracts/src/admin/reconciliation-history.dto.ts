import { z } from "zod";

// Admin RECONCILIATION-HISTORY DTOs (Go-readiness #3) — the DURABLE run log +
// break lifecycle. Distinct from the ephemeral, projected break list in
// `reconciliation.dto.ts` (`ReconBreak*` = provider-vs-ledger discrepancies
// computed on read): the shapes here mirror the PERSISTED `ReconRun` /
// `ReconBreak` engine tables, so a reconciliation run + its detected breaks
// survive a restart and carry an acknowledge/resolve lifecycle.
//
// Everything here is READ/ANNOTATE only — a break disposition records an operator
// decision + an immutable audit entry; it moves no money (§3.1). Amounts (`delta`)
// are byte-stable strings; timestamps are ISO. No PII crosses this boundary — a
// break references its user/wallet/outbox by opaque id only (§3.4). Names are
// prefixed (`ReconRun*`, `PersistedReconBreak*`) so they never collide with the
// projected `ReconBreak*` types.
//
// Single source of truth shared by the API (response + request parsing) and web-admin.

// ── Run type — which reconciler produced the run ─────────────────────────────────
// - settlement_outbox — the cron that re-drives stuck SettlementOutbox rows.
// - wallet_deposit     — the admin-triggered on-chain-vs-ledger deposit reconcile.
export const ReconRunTypeSchema = z.enum([
  "settlement_outbox",
  "wallet_deposit",
]);
export type ReconRunType = z.infer<typeof ReconRunTypeSchema>;

// ── Run status — the run's lifecycle ────────────────────────────────────────────
// `running` while the batch executes; `completed` on a clean drain; `failed` when
// the batch itself threw (persist-first means the row exists either way).
export const ReconRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type ReconRunStatus = z.infer<typeof ReconRunStatusSchema>;

// ── One persisted reconciliation run ─────────────────────────────────────────────
// `totalChecked` = rows/assets examined; `breaksDetected` = discrepancies recorded.
// `completedAt` is null while the run is still `running`. Timestamps are ISO.
export const ReconRunSchema = z.object({
  id: z.string(),
  runType: ReconRunTypeSchema,
  status: ReconRunStatusSchema,
  totalChecked: z.number().int().nonnegative(),
  breaksDetected: z.number().int().nonnegative(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ReconRun = z.infer<typeof ReconRunSchema>;

// ── Run history page (keyset-paginated) ──────────────────────────────────────────
// `nextCursor` is the opaque seek token for the next page (createdAt+id), or null
// when the last page has been reached.
export const ReconRunListResponseSchema = z.object({
  items: z.array(ReconRunSchema),
  nextCursor: z.string().nullable(),
});
export type ReconRunListResponse = z.infer<typeof ReconRunListResponseSchema>;

// ── Break type — the discrepancy class the reconciler detected ───────────────────
// - balance_mismatch    — a wallet on-chain vs ledger delta remediated by the engine.
// - over_credit         — ledger exceeds on-chain (flagged, NEVER auto-debited, §3.1).
// - settlement_failure  — a stuck SettlementOutbox row failed to re-drive.
export const PersistedReconBreakTypeSchema = z.enum([
  "balance_mismatch",
  "over_credit",
  "settlement_failure",
]);
export type PersistedReconBreakType = z.infer<
  typeof PersistedReconBreakTypeSchema
>;

// ── Break status — the disposition lifecycle ─────────────────────────────────────
// `detected` on record; an operator moves it to `acknowledged` (triaged) then a
// terminal `resolved` / `rejected`. Only the annotation columns change — the
// detected facts (type/delta/currency) are immutable (§3.6, mirrors disposeSanctions).
export const PersistedReconBreakStatusSchema = z.enum([
  "detected",
  "acknowledged",
  "resolved",
  "rejected",
]);
export type PersistedReconBreakStatus = z.infer<
  typeof PersistedReconBreakStatusSchema
>;

// ── One persisted reconciliation break ───────────────────────────────────────────
// `userId`/`walletId`/`outboxId` are opaque, nullable refs (a wallet break carries a
// user+wallet; a settlement break carries an outboxId). `delta` is the signed
// discrepancy as a byte-stable string. `approvedByAdminId`/`reason`/`actionAt` are
// the audited disposition annotation (null until an operator acts).
export const PersistedReconBreakSchema = z.object({
  id: z.string(),
  reconRunId: z.string(),
  breakType: PersistedReconBreakTypeSchema,
  userId: z.string().nullable(),
  walletId: z.string().nullable(),
  outboxId: z.string().nullable(),
  currency: z.string(),
  delta: z.string(),
  status: PersistedReconBreakStatusSchema,
  approvedByAdminId: z.string().nullable(),
  reason: z.string().nullable(),
  actionAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersistedReconBreak = z.infer<typeof PersistedReconBreakSchema>;

// ── Run detail — a run plus every break it detected ──────────────────────────────
export const ReconRunDetailSchema = z.object({
  run: ReconRunSchema,
  breaks: z.array(PersistedReconBreakSchema),
});
export type ReconRunDetail = z.infer<typeof ReconRunDetailSchema>;

// ── Request: acknowledge / resolve a break ───────────────────────────────────────
// `reason` is the operator's audited justification (non-empty). Both transitions
// are annotation-only — they record the operator decision + an immutable audit
// entry and move no money (§3.1).
export const ReconBreakActionRequestSchema = z.object({
  reason: z.string().min(1),
});
export type ReconBreakActionRequest = z.infer<
  typeof ReconBreakActionRequestSchema
>;
