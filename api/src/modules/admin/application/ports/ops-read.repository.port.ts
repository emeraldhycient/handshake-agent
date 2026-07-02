/**
 * DI token + port for the admin OPS read repository (Phase 6b).
 *
 * READ-ONLY operational board for the "System / ops" operator screen — the
 * per-provider status board, the webhook-ingest queue depths + retries, and the
 * background-jobs / cron registry (schedule + last observed run + status). Projects
 * existing SettlementOutbox rows + the declared cron/job registry; there is no ops
 * home module, so the admin layer owns this read (mirrors METRICS_OPS_READ_REPOSITORY).
 *
 * The concrete Prisma adapter lives in `admin/infrastructure`; application/domain
 * depend only on this abstraction (clean-arch §4.1, CLAUDE.md §3.2). Nothing here
 * mutates anything (§3.1); no PII crosses this boundary (system events only).
 */
export const OPS_READ_REPOSITORY = Symbol('OPS_READ_REPOSITORY');

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

export type OpsHealth = 'ok' | 'warn' | 'down';

/** A provider's observed dispatch health from its SettlementOutbox rows. */
export interface OpsProviderStatusRow {
  key: string;
  name: string;
  health: OpsHealth;
  /** Most recent observed dispatch→completion latency (ms), or null when unobserved. */
  lastLatencyMs: number | null;
}

/** One webhook-ingest queue's live depth + in-flight retry count. */
export interface OpsWebhookQueueRow {
  key: string;
  depth: number;
  retries: number;
  health: OpsHealth;
}

export type OpsJobStatus = 'idle' | 'running' | 'ok' | 'failed';

/** One registered background job / cron + its last observable run outcome. */
export interface OpsJobRow {
  id: string;
  name: string;
  /** Declared cron expression (a deploy-time constant). */
  schedule: string;
  /** Most recent observable run timestamp, or null when none observed. */
  lastRunAt: Date | null;
  status: OpsJobStatus;
  health: OpsHealth;
}

/** The composite ops-board projection. */
export interface OpsBoardResult {
  providers: OpsProviderStatusRow[];
  webhookQueues: OpsWebhookQueueRow[];
  jobs: OpsJobRow[];
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IOpsReadRepository {
  /**
   * The composite ops board — per-provider dispatch health, the webhook-ingest
   * queue depths + retries, and the background-jobs / cron registry with each
   * job's last observable run. All derived from real SettlementOutbox rows + the
   * declared cron registry; no synthetic probes, no fabricated latency. No PII.
   */
  board(): Promise<OpsBoardResult>;
}
