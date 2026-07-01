/**
 * DI token + port for the admin METRICS-OPS read repository (Phase 6b).
 *
 * READ-ONLY operational-health signals for the operator dashboard's three
 * still-mock panels — System health, Live activity, and Open compliance cases.
 * Projects existing SettlementOutbox / CompensationRecord / Transaction /
 * AuditLog / ComplianceEvent rows; there is no metrics-ops home module, so the
 * admin layer owns this read (mirrors METRICS_READ_REPOSITORY).
 *
 * The concrete Prisma adapter lives in `admin/infrastructure`; application/domain
 * depend only on this abstraction (clean-arch §4.1, CLAUDE.md §3.2). Nothing here
 * mutates anything (§3.1); no PII crosses this boundary (system events only).
 */
export const METRICS_OPS_READ_REPOSITORY = Symbol(
  'METRICS_OPS_READ_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

/** A provider's observed dispatch health from its SettlementOutbox rows. */
export interface ProviderHealthRow {
  key: string;
  name: string;
  note: string;
  status: 'ok' | 'degraded' | 'down';
  /** Most recent observed dispatch→completion latency (ms), or null when unobserved. */
  lastLatencyMs: number | null;
}

export interface SystemHealthResult {
  providers: ProviderHealthRow[];
  /** SettlementOutbox rows awaiting dispatch/verification. */
  webhookQueueDepth: number;
  /** Unresolved CompensationRecord rows (reconciliation drift). */
  reconDriftCount: number;
}

export type ActivityKind =
  | 'settled'
  | 'kyc_approved'
  | 'config_change'
  | 'failed'
  | 'sweep'
  | 'refund';

/** One activity-feed row projected from a real domain event. */
export interface ActivityEventRow {
  id: string;
  kind: ActivityKind;
  title: string;
  meta: string;
  /** Event timestamp. */
  at: Date;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IMetricsOpsReadRepository {
  /**
   * Per-provider dispatch health (from the recent SettlementOutbox window), the
   * pending settlement/webhook queue depth, and the count of unresolved
   * compensation reconciliations. Providers with no observed dispatch report
   * `status: 'ok'` and `lastLatencyMs: null`.
   */
  systemHealth(): Promise<SystemHealthResult>;

  /**
   * The most recent `limit` cross-domain platform events (settled/failed txns,
   * KYC approvals + config changes from the audit log, engine sweeps/refunds),
   * newest first. No PII — opaque refs only.
   */
  activityFeed(limit: number): Promise<ActivityEventRow[]>;

  /** The count of open (flagged + under_review) compliance cases. */
  openComplianceCount(): Promise<number>;
}
