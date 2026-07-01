/**
 * DI token + port for the admin BROADCAST-DISPATCH repository (Comms broadcast
 * send, Phase 7).
 *
 * Resolves an audience cohort to its recipient set and ENQUEUES the broadcast into
 * the notifications module's outbox (one `Notification` per recipient) — the same
 * outbox the deterministic dispatch worker already drains. This is the ONLY door
 * to the database for the broadcast service (clean-arch §4.1, CLAUDE.md §3.2); the
 * concrete Prisma adapter lives in `admin/infrastructure`.
 *
 * FUNDS-SAFETY: a broadcast moves NO money (§3.1). The enqueue is IDEMPOTENT — each
 * recipient row is anchored on the outbox's `(eventRef, eventType)` unique via a
 * deterministic per-recipient `eventRef` derived from the broadcast id, so a
 * replayed request (or an approved maker-checker re-run) never double-blasts.
 */

import type { BroadcastAudience } from '@handshake-agent/contracts';

export const BROADCAST_DISPATCH_REPOSITORY = Symbol(
  'BROADCAST_DISPATCH_REPOSITORY',
);

/** The parameters an enqueue needs — a stable broadcast id anchors idempotency. */
export interface EnqueueBroadcastInput {
  /**
   * Stable id for this broadcast; the per-recipient outbox `eventRef` is derived
   * from it (`broadcast:<broadcastId>:<userId>`) so re-enqueueing is a no-op.
   */
  broadcastId: string;
  audience: BroadcastAudience;
  templateKey: string;
  /** Frozen render variables for the outbox rows (the broadcast context). */
  templateVars: Record<string, unknown>;
  /** ISO-8601 send time; null → dispatch as soon as the worker drains it. */
  sendAt: string | null;
}

/** The result of an enqueue — how many outbox rows were newly created. */
export interface EnqueueBroadcastResult {
  /** The resolved cohort size (recipients targeted). */
  recipientCount: number;
  /** Rows newly inserted (excludes idempotent duplicates on a replay). */
  enqueuedCount: number;
}

export interface IBroadcastDispatchRepository {
  /**
   * Resolve the cohort's current size WITHOUT enqueuing anything — the server-side
   * basis for the maker-checker size gate (never trust the client's estimate).
   */
  countAudience(audience: BroadcastAudience): Promise<number>;

  /**
   * Enqueue the broadcast into the notifications outbox (one row per recipient),
   * idempotently on the derived per-recipient `eventRef`. Returns the resolved
   * cohort size + the count of rows newly created.
   */
  enqueueBroadcast(
    input: EnqueueBroadcastInput,
  ): Promise<EnqueueBroadcastResult>;
}
