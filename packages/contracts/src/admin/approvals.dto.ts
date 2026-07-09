import { z } from "zod";

// Admin APPROVALS / maker-checker DTOs (Phase 7, WRITES) — the change-request
// subsystem that gates sensitive platform mutations behind a SECOND admin's
// confirmation. A change is captured as a pending ChangeRequest (the "maker");
// a different admin approves it (the "checker"), at which point the target
// change is APPLIED atomically + audited — or rejects it with a reason. The
// requester can NEVER self-approve (four-eyes principle).
//
// Single source of truth shared by the API (request parsing + response parsing)
// and web-admin (the approvals inbox + the create/approve/reject flows). No PII
// crosses this boundary — a request references its target by opaque resource
// string only (§3.4), and money-affecting kinds carry only the parameters the
// target service re-validates (never a raw ledger instruction, §3.1).

// ── Kind — the class of change under review, selecting the applier on approve ────
// Each kind maps to an existing target service's mutation that is RE-EXECUTED on
// approval (never a raw write): pricing/flag/limit changes route through the
// layered-config service; a refund routes through the engine's atomic refund.
// Grows additively as more sensitive mutations are placed behind maker-checker.
export const ChangeRequestKindSchema = z.enum([
  "pricing_change",
  "capability_flip",
  "tier_override",
  "refund",
  // manual_credit routes through the engine's atomic `settleManualCreditAtomic`
  // on approval — a double-entry credit of an end user's custodial wallet, never
  // a raw ledger write (§3.1). The payload carries { userId, asset, amount }.
  "manual_credit",
  // notification_broadcast re-runs the notifications-outbox dispatch on approval —
  // a LARGE-audience broadcast deferred to a second admin (§3.5). It moves NO money;
  // the payload carries { audience, templateKey, schedule } that the broadcast
  // service re-validates and re-enqueues idempotently on approval.
  "notification_broadcast",
  // payout_release re-drives a QUEUED payout's settlement on approval — it
  // re-enqueues the settlement outbox for the reconciliation worker via the engine's
  // atomic path (never a raw ledger write, §3.1). The payload carries
  // { transactionId } (the offending payout's txn) that the triage service
  // re-validates; the actual release is settled idempotently by the engine worker.
  "payout_release",
  // user_tier_override moves a SINGLE end user's account KYC tier behind four-eyes —
  // the per-user tier change (formerly an immediate PATCH /admin/users/:id/tier)
  // now enters the maker-checker queue. On approval it re-runs the end-user
  // tier-adjust service with { userId, tier } from the payload (re-validated
  // server-side, §3.3). It moves NO money (a tier gates limits; it is not a ledger
  // write, §3.1).
  "user_tier_override",
]);
export type ChangeRequestKind = z.infer<typeof ChangeRequestKindSchema>;

// ── Status — the request's lifecycle. Terminal states carry a decider + reason ───
export const ChangeRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusSchema>;

// ── Create input ─────────────────────────────────────────────────────────────────
// `resource` is a stable, human-readable target descriptor the inbox renders
// verbatim (e.g. "pricing.assets.USDT.baseRates.NGN", "capability.crypto.buy",
// "Transaction:<id>"). `payload` is the kind-specific parameter bag the applier
// re-validates on approval — it is stored opaquely and NEVER trusted as a
// financial instruction; the target service re-checks it server-side (§3.1/§3.3).
// `reason` is the maker's justification (audited, shown in the inbox).
export const CreateChangeRequestSchema = z.object({
  kind: ChangeRequestKindSchema,
  resource: z.string().min(1).max(200),
  payload: z.record(z.unknown()),
  reason: z.string().min(3).max(500),
});
export type CreateChangeRequest = z.infer<typeof CreateChangeRequestSchema>;

// ── Reject input ─────────────────────────────────────────────────────────────────
export const RejectChangeRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type RejectChangeRequest = z.infer<typeof RejectChangeRequestSchema>;

// ── ChangeRequest view ───────────────────────────────────────────────────────────
// Actor ids are opaque uuids; `requestedByEmail` / `decidedByEmail` are the
// operator-facing display the inbox renders (admin operators, not end users —
// no end-user PII, §3.4). Timestamps are ISO. `decidedBy*` / `decidedAt` /
// `decisionReason` are null while pending.
export const ChangeRequestSchema = z.object({
  id: z.string().uuid(),
  kind: ChangeRequestKindSchema,
  resource: z.string(),
  payload: z.record(z.unknown()),
  status: ChangeRequestStatusSchema,
  reason: z.string(),
  requestedByAdminId: z.string().uuid(),
  requestedByEmail: z.string().nullable(),
  decidedByAdminId: z.string().uuid().nullable(),
  decidedByEmail: z.string().nullable(),
  decisionReason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

// ── Inbox response ───────────────────────────────────────────────────────────────
// Two lanes the operator toggles between: `awaitingMe` (pending requests this
// admin may act on — i.e. NOT their own, since self-approval is forbidden) and
// `myRequests` (requests this admin raised, any status). `counts` drives the
// nav badge + tab counters without a second round-trip.
export const ChangeRequestInboxCountsSchema = z.object({
  awaitingMe: z.number().int().nonnegative(),
  myRequests: z.number().int().nonnegative(),
  myPending: z.number().int().nonnegative(),
});
export type ChangeRequestInboxCounts = z.infer<
  typeof ChangeRequestInboxCountsSchema
>;

export const ChangeRequestInboxResponseSchema = z.object({
  awaitingMe: z.array(ChangeRequestSchema),
  myRequests: z.array(ChangeRequestSchema),
  counts: ChangeRequestInboxCountsSchema,
});
export type ChangeRequestInboxResponse = z.infer<
  typeof ChangeRequestInboxResponseSchema
>;
