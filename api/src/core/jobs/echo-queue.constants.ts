/**
 * Echo queue constants.
 *
 * The echo queue is the minimal example queue used to prove the
 * enqueue → process round-trip in the BullMQ integration test (BQ-1).
 * It has no business logic — it simply records that a job was processed.
 *
 * Real processors will be added in BQ-2 and beyond.
 */
export const ECHO_QUEUE_NAME = 'echo' as const;
export const ECHO_JOB_NAME = 'ping' as const;
