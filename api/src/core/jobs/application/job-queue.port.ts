/**
 * JobQueue port (application layer, clean-arch §4.1).
 *
 * The single capability surface for enqueuing background jobs. Application
 * code depends only on this interface — it never imports BullMQ, ioredis, or
 * any infrastructure concern directly.
 *
 * Adapters:
 *   - BullMqJobQueueAdapter (infrastructure) — wires the real BullMQ / Redis path.
 *   - InMemoryJobQueueAdapter (test utility) — zero-Redis drop-in for unit tests.
 *
 * The `jobId` field enables idempotent enqueueing / deduplication: if a job with
 * the same `jobId` already exists in the queue, BullMQ will not add a duplicate.
 */
export interface EnqueueInput {
  /** Target queue name (must match a registered BullMQ queue). */
  queue: string;
  /** Job type name — the `@Processor` dispatch key. */
  name: string;
  /** Arbitrary serialisable payload. */
  data: unknown;
  opts?: {
    /** Number of automatic retry attempts on failure. */
    attempts?: number;
    /** Fixed back-off delay in milliseconds between retries. */
    backoffMs?: number;
    /**
     * Deduplication key. When set, BullMQ will not enqueue a duplicate job
     * while one with the same jobId is already active / waiting.
     */
    jobId?: string;
  };
}

export interface EnqueueResult {
  /** BullMQ job id (string form of the numeric id when no jobId is supplied). */
  id: string;
}

export const JOB_QUEUE = Symbol('JOB_QUEUE');

export interface JobQueue {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
}
