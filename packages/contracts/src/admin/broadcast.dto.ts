import { z } from "zod";

// Admin BROADCAST-SEND DTOs (Phase 7, WRITES) — the Comms console's broadcast
// composer: an operator picks an audience COHORT + a notification TEMPLATE + a
// SCHEDULE and dispatches the message through the notifications module's outbox.
//
// FUNDS-SAFETY / dual-control (root CLAUDE.md §3.1/§3.5): a broadcast moves NO
// money, but a large blast is high-impact, so the size gate is enforced
// SERVER-SIDE, never trusted from the client. A SMALL audience is confirmed then
// dispatched directly (step-up + audit). A LARGE audience is captured as a pending
// maker-checker ChangeRequest (`notification_broadcast` kind) and only dispatched
// once a SECOND admin approves it (four-eyes) — the same outbox path is re-executed
// on approval, never a raw send. The send is IDEMPOTENCY-keyed at the outbox so a
// replayed request never double-blasts. No end-user PII crosses this boundary — the
// request references a cohort + template key only (§3.4).
//
// Single source of truth shared by the API (request + response parsing) and
// web-admin (the composer's confirm-modal submit).

// ── Audience cohort — the recipient segment the blast targets ────────────────────
// A stable identifier the server resolves to a concrete recipient set + count.
// Grows additively as more segments are modeled; the server is the sole authority
// on each cohort's membership (the client never sends a recipient list).
export const BroadcastAudienceSchema = z.enum([
  "all",
  "verified",
  "tier_1",
  "lagos",
]);
export type BroadcastAudience = z.infer<typeof BroadcastAudienceSchema>;

// ── Schedule — when the blast goes out ───────────────────────────────────────────
// `now` dispatches immediately; `scheduled` defers to `sendAt` (ISO-8601, must be
// in the future — the server re-checks). The discriminated union keeps `sendAt`
// present only when it is meaningful.
export const BroadcastScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("now") }),
  z.object({ kind: z.literal("scheduled"), sendAt: z.string().datetime() }),
]);
export type BroadcastSchedule = z.infer<typeof BroadcastScheduleSchema>;

// ── Send request ─────────────────────────────────────────────────────────────────
// `reason` is the operator's justification (audited; also the maker's reason when a
// large audience defers to approval). `templateKey` names the notification template
// that renders the message.
export const BroadcastSendRequestSchema = z.object({
  audience: BroadcastAudienceSchema,
  templateKey: z.string().min(1).max(200),
  schedule: BroadcastScheduleSchema,
  reason: z.string().min(3).max(500),
});
export type BroadcastSendRequest = z.infer<typeof BroadcastSendRequestSchema>;

// ── Send response ────────────────────────────────────────────────────────────────
// The server-decided outcome:
//   - `dispatched`             — a small audience: enqueued to the outbox now.
//   - `queued_for_approval`    — a large audience: captured as a pending
//                                maker-checker ChangeRequest for a second admin.
// `recipientCount` is the server-resolved cohort size (the size gate's basis), so
// the UI never has to trust its own reach estimate. `changeRequestId` is the raised
// approval request id when queued, else null.
export const BroadcastOutcomeSchema = z.enum([
  "dispatched",
  "queued_for_approval",
]);
export type BroadcastOutcome = z.infer<typeof BroadcastOutcomeSchema>;

export const BroadcastSendResponseSchema = z.object({
  outcome: BroadcastOutcomeSchema,
  recipientCount: z.number().int().nonnegative(),
  changeRequestId: z.string().uuid().nullable(),
});
export type BroadcastSendResponse = z.infer<typeof BroadcastSendResponseSchema>;
