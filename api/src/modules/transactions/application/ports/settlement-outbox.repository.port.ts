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
  /** 'processor_collection' | 'processor_payout' | 'onchain_send' | 'compensation' */
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
  createdAt: Date;
}

export interface ISettlementOutboxRepository {
  /**
   * Persists a new SettlementOutbox row and returns the created record.
   */
  create(data: CreateSettlementOutboxData): Promise<SettlementOutboxRecord>;
}
