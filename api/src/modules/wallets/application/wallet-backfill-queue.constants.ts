/**
 * Queue + job-name constants for the async wallet-network backfill (BQ-2).
 *
 * Two job types share one queue:
 *   - `coordinate`: paginates all active users and fans out `provision-user` jobs.
 *   - `provision-user`: idempotent per-user provisioning (rate-limited for Blockradar).
 */
export const WALLET_BACKFILL_QUEUE_NAME = 'wallet-backfill' as const;

export const WALLET_BACKFILL_JOB = {
  COORDINATE: 'coordinate',
  PROVISION_USER: 'provision-user',
} as const;

/**
 * Payload of the `coordinate` job. Lives in the application layer so queue
 * producers (admin controller, CLI) never import the infrastructure processor.
 */
export interface CoordinateBackfillPayload {
  runId: string;
  dryRun: boolean;
  batchSize: number;
}
