/**
 * DI token and port contract for the SettlementOutbox repository.
 *
 * Infrastructure provides the concrete Prisma adapter. Application depends only
 * on this interface (clean-arch §4.1, CLAUDE.md §3.2).
 */
export const SETTLEMENT_OUTBOX_REPOSITORY = Symbol(
  'SETTLEMENT_OUTBOX_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Application-level types — NOT the Prisma-generated types.
// ---------------------------------------------------------------------------

export interface CreateSettlementOutboxData {
  transactionId: string;
  /** 'processor_collection' | 'processor_payout' | 'onchain_send' | 'compensation' | 'swap' */
  settlementType: string;
  /** Idempotent settlement request payload — immutable; used for replay detection. */
  payload: Record<string, unknown>;
  /** Optional idempotency key (UUID) for at-most-once settlement dispatch. */
  idempotencyKey?: string;
  /** 'pending' | 'enqueued' | 'in_progress' | 'completed' | 'failed' */
  status: string;
  /** Processor/on-chain reference returned after first dispatch. */
  processorRef?: string;
}

export interface SettlementOutboxRecord {
  id: string;
  transactionId: string;
  settlementType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  status: string;
  processorRef: string | null;
  attempt: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

export interface FindPendingOptions {
  /** Only return rows whose createdAt is older than this many seconds (grace window). */
  olderThanSec: number;
  /** Maximum number of rows to return. */
  limit: number;
}

export interface ISettlementOutboxRepository {
  /**
   * Persists a new SettlementOutbox row and returns the created record.
   */
  create(data: CreateSettlementOutboxData): Promise<SettlementOutboxRecord>;

  /**
   * Returns pending outbox rows older than the grace window, up to limit.
   * Used by SettlementReconciliationService to find missed-webhook rows.
   */
  findPending(options: FindPendingOptions): Promise<SettlementOutboxRecord[]>;

  /**
   * Increments the attempt counter and sets lastAttemptAt to now.
   * Called before re-driving settlement to avoid hot-looping.
   */
  markAttempt(id: string): Promise<void>;

  /**
   * Marks the outbox row as completed (terminal state — row is drained).
   */
  complete(id: string): Promise<void>;

  /**
   * Returns the outbox row for a transaction, or null if none exists.
   * Used by admin triage (Phase 3B) to find the settlement row to re-enqueue.
   * A transaction has at most one in-flight settlement outbox row at a time.
   */
  findByTransactionId(
    transactionId: string,
  ): Promise<SettlementOutboxRecord | null>;

  /**
   * Re-arms a settlement outbox row for the reconciliation worker: sets status
   * back to 'pending' (and clears the terminal/attempt markers — completedAt,
   * failureReason, lastAttemptAt) so the existing `findPending` sweep re-drives
   * settlement on its next pass. Admin retry uses this — it NEVER re-executes
   * settlement inline (§3.1: the engine, not the admin path, settles).
   */
  resetToPending(id: string): Promise<void>;
}
