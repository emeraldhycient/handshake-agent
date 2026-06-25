import { z } from 'zod'

/**
 * Request DTO for the wallet network backfill operation.
 *
 * Used by:
 *   - POST /admin/wallets/backfill-networks (AdminWalletsController)
 *   - CLI backfill-wallet-networks.ts (reads DRY_RUN / BATCH_SIZE from env)
 *   - Web admin UI (future — imports this schema directly for form validation)
 *
 * One shape, three consumers (CLAUDE.md §8 / WN-5).
 */
export const BackfillNetworksRequestSchema = z.object({
  /**
   * Number of user IDs fetched per DB page. Defaults to 100.
   * Tune down for lower provider-call pressure; tune up for faster completion
   * on very large user bases.
   */
  batchSize: z.number().int().positive().optional(),
  /**
   * When true, the service tallies which networks each user is missing but
   * does NOT call the provider. Returns the same BackfillReport shape so
   * operators can audit scope before a live run.
   */
  dryRun: z.boolean().optional(),
})
export type BackfillNetworksRequest = z.infer<typeof BackfillNetworksRequestSchema>

/**
 * Per-network provisioning tally returned inside BackfillReport.
 */
export const PerNetworkTallySchema = z.object({
  /** Users who already had this network wallet — skipped (idempotent). */
  alreadyHad: z.number().int().nonnegative(),
  /** Wallets created (or would-be created in dryRun=true mode). */
  provisioned: z.number().int().nonnegative(),
})
export type PerNetworkTally = z.infer<typeof PerNetworkTallySchema>

/**
 * Failure record for a single user in the backfill batch.
 */
export const BackfillFailureSchema = z.object({
  userId: z.string(),
  error: z.string(),
})
export type BackfillFailure = z.infer<typeof BackfillFailureSchema>

/**
 * Response shape for the backfill operation.
 *
 * Returned by WalletBackfillService, the CLI, and POST /admin/wallets/backfill-networks.
 * One shape imported by the web admin UI (future).
 */
export const BackfillReportSchema = z.object({
  /** Total users scanned (active users, regardless of outcome). */
  usersScanned: z.number().int().nonnegative(),
  /**
   * Per-network breakdown.
   * Keys are network ids matching the AssetRegistry (e.g. "TRON", "ETH").
   */
  perNetwork: z.record(PerNetworkTallySchema),
  /** Per-user failures (per-user isolation — the batch continues on error). */
  failures: z.array(BackfillFailureSchema),
})
export type BackfillReport = z.infer<typeof BackfillReportSchema>

// ── BQ-2: async BackfillRun status shapes ────────────────────────────────────

/**
 * Lifecycle status of an async backfill run (BQ-2).
 * Mirrors the Prisma BackfillRunStatus enum.
 */
export const BackfillRunStatusEnum = z.enum(['queued', 'running', 'completed', 'failed'])
export type BackfillRunStatus = z.infer<typeof BackfillRunStatusEnum>

/**
 * The full BackfillRun record returned by GET /admin/wallets/backfill-runs/:id.
 * The admin UI polls this; the CLI uses it to show final progress.
 */
export const BackfillRunStatusSchema = z.object({
  id: z.string().uuid(),
  status: BackfillRunStatusEnum,
  dryRun: z.boolean(),
  totalUsers: z.number().int().nonnegative(),
  scannedUsers: z.number().int().nonnegative(),
  /**
   * Per-network breakdown.
   * Keys are network ids (e.g. "TRON"); values are { alreadyHad, provisioned }.
   */
  perNetwork: z.record(PerNetworkTallySchema),
  /** Per-user failures accumulated during the run. */
  failures: z.array(BackfillFailureSchema),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
})
export type BackfillRunStatusDto = z.infer<typeof BackfillRunStatusSchema>

/**
 * Response body for POST /admin/wallets/backfill-networks (HTTP 202).
 * The caller uses runId to poll GET /admin/wallets/backfill-runs/:id.
 */
export const EnqueueBackfillResponseSchema = z.object({
  runId: z.string().uuid(),
})
export type EnqueueBackfillResponse = z.infer<typeof EnqueueBackfillResponseSchema>
