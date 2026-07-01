/**
 * DI token + port for the admin USER-BULK repository (Users directory bulk bar,
 * Phase 7). Backs the two bulk actions over an EXPLICIT selected set of end-user
 * ids: applying an operator TAG, and QUEUEING a templated broadcast message.
 *
 * This is the ONLY door to the database for the bulk service (clean-arch §4.1,
 * CLAUDE.md §3.2); the concrete Prisma adapter lives in `admin/infrastructure`.
 * Neither operation moves money (§3.1): a tag is a pure annotation, and a message
 * enqueues rows onto the notifications OUTBOX (the same at-most-once path the
 * dispatch worker already drains) — never a direct send. Both are IDEMPOTENT:
 *   - tags on the (userId, tag) unique — `applyTag` counts only NEW rows;
 *   - messages on the outbox `(eventRef, eventType)` unique via a per-recipient
 *     `eventRef` derived from the shared `broadcastRef` — `enqueueMessage` counts
 *     only NEW rows, so a replay never double-blasts.
 *
 * Distinct from the cohort-based BROADCAST_DISPATCH_REPOSITORY (Comms console):
 * that resolves an audience segment; this targets a caller-supplied id list.
 */

import type { BulkMessageEventType } from '@handshake-agent/contracts';

export const USER_BULK_REPOSITORY = Symbol('USER_BULK_REPOSITORY');

/** Parameters for enqueueing a templated broadcast to an explicit id set. */
export interface EnqueueMessageInput {
  /** The de-duplicated, already-existence-checked recipient ids. */
  userIds: string[];
  /** The outbox event type (an operator-allowed broadcast event). */
  eventType: BulkMessageEventType;
  /** References a persisted NotificationTemplate.templateKey (admin-authored). */
  templateKey: string;
  /** Frozen render variables stamped on each outbox row. */
  templateVars: Record<string, unknown>;
  /**
   * Stable ref for this broadcast; the per-recipient outbox `eventRef` is derived
   * from it (`bulk:<broadcastRef>:<userId>`) so re-enqueueing is a no-op.
   */
  broadcastRef: string;
}

export interface IUserBulkRepository {
  /** Which of `userIds` exist (an active, non-deleted user)? Guards a bad selection. */
  filterExistingUserIds(userIds: string[]): Promise<string[]>;

  /**
   * Idempotently apply `tag` to each id, attributed to `adminId`. Skips ids that
   * already carry the tag. Returns the number of NEW rows created.
   */
  applyTag(
    userIds: string[],
    tag: string,
    adminId: string,
  ): Promise<{ created: number }>;

  /**
   * Enqueue one outbox `Notification` per recipient, idempotently on the derived
   * per-recipient `eventRef`. Returns the count of rows newly created.
   */
  enqueueMessage(input: EnqueueMessageInput): Promise<{ enqueued: number }>;
}
