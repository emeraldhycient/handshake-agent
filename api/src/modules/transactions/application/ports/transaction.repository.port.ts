/**
 * DI token and port contract for the Transaction repository.
 *
 * Infrastructure provides the concrete Prisma adapter. Application depends only
 * on this interface (clean-arch §4.1, CLAUDE.md §3.2).
 */
export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');

// ---------------------------------------------------------------------------
// String-literal unions for status fields (I1).
// Defined here in the application/port layer — NOT importing Prisma enum types.
// ---------------------------------------------------------------------------

/** Executable Proposal statuses recognised by the engine. */
export type ProposalStatus =
  | 'pending'
  | 'confirmed'
  | 'executing'
  | 'executed'
  | 'expired'
  | 'rejected'
  | 'failed';

/** Transaction lifecycle statuses. */
export type TransactionStatus =
  | 'pending'
  | 'settling'
  | 'completed'
  | 'failed'
  | 'rolled_back';

// ---------------------------------------------------------------------------
// Application-level types — NOT the Prisma-generated types.
// ---------------------------------------------------------------------------

export interface CreateTransactionData {
  /** FK to Proposal — nullable (not all transactions come from proposals). */
  proposalId?: string;
  userId: string;
  /** 'buy' | 'sell' | 'send' | 'swap' | 'ticket_purchase' | 'reward' | 'refund' */
  type: string;
  status: TransactionStatus;
  /** UUID — caller generates this for at-most-once semantics (NFR-7). */
  idempotencyKey: string;
  /** SHA-256 hex of canonical request params (asset/amount/destination). */
  requestChecksum: string;
  /** FX rate locked at quote time, stored as string for precision. */
  fxRateSnapshot?: string;
  /** Type-specific metadata: { asset, fiatAmount, cryptoAmount, fxRate, ... }. */
  metadata: Record<string, unknown>;
  /** Timestamp when PIN was verified for this transaction. */
  pinVerifiedAt?: Date;
}

export interface TransactionRecord {
  id: string;
  proposalId: string | null;
  userId: string;
  type: string;
  status: string;
  idempotencyKey: string;
  requestChecksum: string;
  fxRateSnapshot: string | null;
  metadata: Record<string, unknown>;
  processorTxRef: string | null;
  pinVerifiedAt: Date | null;
  createdAt: Date;
}

/**
 * Velocity counters to atomically increment inside the settling write (V1).
 * Passed by the application layer; the repository executes the upserts in the
 * same DB $transaction so in-flight usage is visible to subsequent gate reads.
 */
export interface VelocityIncrementData {
  userId: string;
  /** Fiat currency code for the counter's window (e.g. 'NGN'). */
  fiatCurrency: string;
  /**
   * Fiat amount for amount_24h counter (as a string to avoid float precision
   * loss — Prisma Decimal accepts a string without rounding).
   */
  fiatAmountStr: string;
  /** Wall-clock `now` supplied by the engine Clock for window calculation. */
  now: Date;
}

/** Data required for an atomic transaction+proposal settling write (C1). */
export interface CreateSettlingWithProposalData {
  txnData: CreateTransactionData;
  /** Proposal to flip to 'executing' in the same DB transaction. */
  proposalId: string;
  /** Optional timestamp to set on Proposal.confirmedAt. */
  confirmedAt?: Date;
  /**
   * When provided, atomically upserts VelocityCounter rows for amount_24h and
   * count_24h in the same Prisma $transaction (V1 — fixes the §3.3 gap where
   * daily velocity caps never tripped because counters were never written).
   */
  velocityIncrement?: VelocityIncrementData;
}

export interface ITransactionRepository {
  /**
   * Looks up a Transaction by its primary key (id).
   * Returns null if no transaction exists for that id.
   */
  findById(id: string): Promise<TransactionRecord | null>;

  /**
   * Looks up a Transaction by its idempotency key.
   * Returns null if no transaction exists for that key.
   */
  findByIdempotencyKey(key: string): Promise<TransactionRecord | null>;

  /**
   * Persists a new Transaction row and returns the created record.
   */
  create(data: CreateTransactionData): Promise<TransactionRecord>;

  /**
   * Atomically creates a Transaction row (status='settling'), updates the
   * associated Proposal to status='executing', and — when `velocityIncrement`
   * is provided — upserts VelocityCounter rows for amount_24h and count_24h,
   * all in a single Prisma $transaction (C1 + V1).
   *
   * A failure at any step rolls back the entire operation:
   *   - No orphan settling Transaction while the Proposal stays pending (C1).
   *   - No partial velocity write that would over- or under-count usage (V1).
   */
  createSettlingWithProposal(
    input: CreateSettlingWithProposalData,
  ): Promise<TransactionRecord>;

  /**
   * Updates the status of an existing Transaction.
   * Optionally sets additional fields (processorTxRef, failureReason, etc.).
   */
  updateStatus(
    id: string,
    status: TransactionStatus,
    fields?: {
      processorTxRef?: string;
      executedAt?: Date;
      completedAt?: Date;
      failedAt?: Date;
      failureReason?: string;
    },
  ): Promise<void>;

  /**
   * Merges the given partial metadata into the Transaction's existing metadata.
   * Used to persist VA details (accountNumber, bankName, providerRef) after
   * createCollection so idempotent replay can reconstruct the full result (C2).
   */
  mergeMetadata(id: string, extra: Record<string, unknown>): Promise<void>;

  /**
   * Read-only history query: transactions for a user within [from, to], optionally
   * filtered by type. Returns the page (capped at `limit`, newest first) AND the
   * exact total count of matching rows in the window. Used by TransactionHistoryService
   * — never mutates. Scoped to `userId` (the security boundary for read-only own data).
   */
  listByUserInRange(input: {
    userId: string;
    from: Date;
    to: Date;
    types?: string[];
    limit: number;
  }): Promise<{ rows: TransactionRecord[]; total: number }>;

  /**
   * Lists a user's transactions newest-first for the activity feed.
   * Keyset-paginated on `id` (uuid7 — time-ordered + unique, so no timestamp-collision row loss);
   * `cursor` is the last-seen transaction id. Returns up to `limit` records.
   */
  findByUserId(
    userId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<TransactionRecord[]>;
}
