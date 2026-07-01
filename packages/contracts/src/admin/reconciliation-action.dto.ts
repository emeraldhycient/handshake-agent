import { z } from "zod";

// Admin RECONCILIATION-ACTION DTOs (Phase 7, WRITES) — the resolve / accept
// dispositions for a provider-vs-ledger break surfaced by the read-only break list
// (`reconciliation.dto.ts`). These are FUNDS-SAFETY-CRITICAL, so they uphold §3.1
// absolutely:
//   • RESOLVE is engine-brokered — it re-drives the offending transaction's
//     settlement through the deterministic engine's EXISTING atomic path (re-enqueue
//     the settlement outbox for the reconciliation worker); it NEVER constructs a
//     ledger entry or auto-debits an over-credit from this surface.
//   • ACCEPT is a dual-control, NO-DEBIT disposition — it records that an operator
//     has accepted the break as-is (e.g. a tolerated rounding drift); it moves no
//     money and writes no ledger entry, only an immutable audit disposition.
// Over-credits are FLAGGED for human action, NEVER auto-debited (root §3.1).
//
// Single source of truth shared by the API (request + response parsing) and
// web-admin. No PII crosses this boundary — a break references its transaction by
// opaque id only (§3.4). The break `id` is the opaque projection id from the read.

// ── Request: resolve a break via the engine (re-drive settlement) ────────────────
// `reason` is the operator's audited justification (non-empty). Resolving NEVER
// debits — it re-enqueues the engine's settlement for the offending transaction.
export const ReconResolveRequestSchema = z.object({
  reason: z.string().min(1),
});
export type ReconResolveRequest = z.infer<typeof ReconResolveRequestSchema>;

// ── Request: accept a break (dual-control, no debit) ─────────────────────────────
// `reason` is the operator's audited justification (non-empty). Accepting records a
// disposition only — no money moves, no ledger entry is written.
export const ReconAcceptRequestSchema = z.object({
  reason: z.string().min(1),
});
export type ReconAcceptRequest = z.infer<typeof ReconAcceptRequestSchema>;

// ── Response: the outcome of a break disposition ─────────────────────────────────
// `breakId` echoes the disposed break; `disposition` is its new terminal state
// (`resolved` for an engine re-drive, `accepted` for a no-debit acceptance);
// `moved` is ALWAYS false — a reconciliation disposition never moves money itself
// (a resolve only re-enqueues; the engine settles atomically later). The `moved`
// field is present + always-false to make the funds-safety invariant explicit in
// the wire shape (§3.1).
export const ReconActionDispositionSchema = z.enum(["resolved", "accepted"]);
export type ReconActionDisposition = z.infer<
  typeof ReconActionDispositionSchema
>;

export const ReconActionResponseSchema = z.object({
  breakId: z.string(),
  disposition: ReconActionDispositionSchema,
  moved: z.literal(false),
});
export type ReconActionResponse = z.infer<typeof ReconActionResponseSchema>;
