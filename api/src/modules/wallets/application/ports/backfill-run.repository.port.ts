/**
 * DI token + port contract for the BackfillRun repository (BQ-2).
 *
 * Application-layer types only — no Prisma / @prisma/client imports.
 * Infrastructure provides the concrete PrismaBackfillRunRepository.
 */
import type {
  BackfillRunStatus,
  PerNetworkTally,
  BackfillFailure,
} from '@handshake-agent/contracts';

export const BACKFILL_RUN_REPOSITORY = Symbol('BACKFILL_RUN_REPOSITORY');

/** Application-level BackfillRun record — DB-agnostic shape. */
export interface BackfillRunRecord {
  id: string;
  status: BackfillRunStatus;
  dryRun: boolean;
  totalUsers: number;
  scannedUsers: number;
  perNetwork: Record<string, PerNetworkTally>;
  failures: BackfillFailure[];
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** Data required to create a new BackfillRun row. */
export interface CreateBackfillRunData {
  dryRun: boolean;
}

/** Atomic counter increment applied by a per-user processor. */
export interface BackfillCounterIncrement {
  /** Increment scannedUsers by this amount (usually 1). */
  scannedUsers?: number;
  /**
   * Per-network delta — merged atomically into the perNetwork JSONB column.
   * Keys are network ids; values are partial tallies (can be just one of the two fields).
   */
  perNetworkDelta?: Record<string, Partial<PerNetworkTally>>;
  /**
   * Failure entry to append to the failures JSONB array.
   * Used by the failed-job handler after all retry attempts are exhausted.
   */
  failure?: BackfillFailure;
}

export interface IBackfillRunRepository {
  /**
   * Create a new BackfillRun in `queued` status.
   */
  create(data: CreateBackfillRunData): Promise<BackfillRunRecord>;

  /**
   * Find a run by id. Returns null when not found.
   */
  findById(id: string): Promise<BackfillRunRecord | null>;

  /**
   * Mark the run `running` and record the start timestamp.
   * Set totalUsers — call once from the coordinator after paging is complete.
   */
  markStarted(id: string, totalUsers: number): Promise<void>;

  /**
   * Atomic counter increment for per-user job results.
   *
   * This is called concurrently by many per-user BullMQ workers, so the
   * implementation must be race-safe (UPDATE ... SET col = col + N, JSONB merge).
   */
  incrementCounters(id: string, delta: BackfillCounterIncrement): Promise<void>;

  /**
   * Mark the run `completed` and record the completion timestamp.
   */
  markCompleted(id: string): Promise<void>;

  /**
   * Mark the run `failed` and record the completion timestamp.
   */
  markFailed(id: string): Promise<void>;
}
