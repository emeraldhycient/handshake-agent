import { z } from "zod";

// Admin BULK operations over a selected set of end users (Phase 7, WRITES) — the
// Users directory's bulk bar: apply an operator TAG, or QUEUE an outbound message
// (a broadcast) to the selection.
//
// Neither path moves money (root CLAUDE.md §3.1): tagging is a pure operator
// annotation, and messaging enqueues rows onto the deterministic notification
// outbox (the same at-most-once dispatch every user notification uses) — it never
// authors free-text with the model and never bypasses the outbox. Both are
// step-up-guarded, idempotent, and immutably audited server-side. A large message
// selection additionally requires an explicit `confirmLargeSet` acknowledgement
// (a lightweight maker gate) so an operator can never fan out a broadcast to more
// than the configured threshold of users without deliberately confirming it.

/** The maximum number of user ids a single bulk request may target. */
export const BULK_USER_IDS_MAX = 500;

/** A non-empty, bounded, de-duplicated set of end-user ids the op targets. */
const BulkUserIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(BULK_USER_IDS_MAX)
  // De-dup so the applied/queued counts and idempotency keys are stable regardless
  // of a repeated id in the selection.
  .transform((ids) => [...new Set(ids)]);

// ── Bulk tag ────────────────────────────────────────────────────────────────────

/**
 * An operator tag label: a short, trimmed, non-empty slug-ish string. Kept free of
 * control characters; the server lower-cases + trims before persisting so the
 * unique (userId, tag) is case-insensitive-stable.
 */
export const UserTagLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\w][\w \-]*$/, "Tag may use letters, numbers, spaces, - and _");
export type UserTagLabel = z.infer<typeof UserTagLabelSchema>;

/** POST /admin/users/tags body — apply one tag to every selected user. */
export const ApplyUserTagsRequestSchema = z.object({
  userIds: BulkUserIdsSchema,
  tag: UserTagLabelSchema,
  /** Operator reason, threaded into the immutable audit record (§reason-first). */
  reason: z.string().trim().min(1).max(280),
});
export type ApplyUserTagsRequest = z.infer<typeof ApplyUserTagsRequestSchema>;

/**
 * POST /admin/users/tags response — how many NEW (userId, tag) rows were created.
 * Idempotent: re-applying an existing tag is a no-op, so `applied` counts only the
 * rows that did not already exist. `requested` is the de-duplicated selection size.
 */
export const ApplyUserTagsResponseSchema = z.object({
  tag: UserTagLabelSchema,
  requested: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
});
export type ApplyUserTagsResponse = z.infer<typeof ApplyUserTagsResponseSchema>;

// ── Bulk message (broadcast) ──────────────────────────────────────────────────────

/**
 * The notification event a broadcast is issued under. A subset of the platform's
 * `NotificationEventType` that is meaningful for an operator-initiated broadcast —
 * not the automated money/KYC events (those are engine-driven). Keeping this an
 * explicit allow-list prevents an operator from spoofing a transactional event.
 */
export const BulkMessageEventTypeSchema = z.enum([
  "balance_update",
  "suspicious_activity_alert",
]);
export type BulkMessageEventType = z.infer<typeof BulkMessageEventTypeSchema>;

/**
 * POST /admin/users/message body — queue a templated broadcast to the selection.
 * The body is NOT free text: it references an existing admin-authored template by
 * key + supplies its render variables, so the model never authors an outbound
 * message (§3.1). `confirmLargeSet` must be true when the selection exceeds the
 * configured large-set threshold — the server re-checks this server-side.
 */
export const BulkMessageRequestSchema = z.object({
  userIds: BulkUserIdsSchema,
  eventType: BulkMessageEventTypeSchema,
  /** References a persisted NotificationTemplate.templateKey (admin-authored). */
  templateKey: z.string().trim().min(1).max(120),
  /** Frozen render variables for the template (string values only). */
  variables: z.record(z.string()).default({}),
  reason: z.string().trim().min(1).max(280),
  /** Explicit maker acknowledgement required for a large selection. */
  confirmLargeSet: z.boolean().default(false),
});
export type BulkMessageRequest = z.infer<typeof BulkMessageRequestSchema>;

/**
 * POST /admin/users/message response — the outbox result. `queued` is the number
 * of notification rows created (idempotent: an already-queued (user, event, ref)
 * is skipped, so a replay yields `queued: 0`). `requested` is the de-duplicated
 * selection size; `broadcastRef` is the shared idempotency ref stamped on every row.
 */
export const BulkMessageResponseSchema = z.object({
  broadcastRef: z.string(),
  eventType: BulkMessageEventTypeSchema,
  requested: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
});
export type BulkMessageResponse = z.infer<typeof BulkMessageResponseSchema>;
