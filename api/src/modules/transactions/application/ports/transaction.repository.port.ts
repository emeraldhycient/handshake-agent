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

/** Data required for an atomic transaction+proposal settling write (C1). */
export interface CreateSettlingWithProposalData {
  txnData: CreateTransactionData;
  /** Proposal to flip to 'executing' in the same DB transaction. */
  proposalId: string;
  /** Optional timestamp to set on Proposal.confirmedAt. */
  confirmedAt?: Date;
}

export interface ITransactionRepository {
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
   * Atomically creates a Transaction row (status='settling') and updates the
   * associated Proposal to status='executing' in a single Prisma $transaction.
   *
   * This prevents the orphan-transaction window (C1): if either write fails
   * the entire operation is rolled back.
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
}
