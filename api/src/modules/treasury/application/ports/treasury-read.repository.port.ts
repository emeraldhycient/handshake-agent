/**
 * DI token and port contract for the admin TREASURY-READ repository (Phase 3,
 * sub-area D). Read-only oversight: aggregated custodial balances, exposure
 * snapshots, threshold alerts (+ acknowledge), and active withdrawal policies.
 *
 * The concrete Prisma adapter lives in `treasury/infrastructure` and implements
 * this contract; application/domain depend only on the abstraction
 * (clean-arch §4.1, CLAUDE.md §3.2). Acknowledging an alert is the only write —
 * it never moves money (§3.1); it stamps the operational acknowledgement state
 * (the full before/after trail lives in the AuditLog).
 *
 * Decimal columns are projected as canonical decimal strings (never Prisma
 * Decimal); dates stay as `Date` and are serialized to ISO at the service layer.
 */
export const TREASURY_READ_REPOSITORY = Symbol('TREASURY_READ_REPOSITORY');

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

/** One aggregated balance row: latest snapshot summed per (network, asset). */
export interface TreasuryBalanceRecord {
  network: string;
  asset: string;
  /** SUM of the latest per-wallet snapshot amounts — canonical decimal string. */
  totalAmount: string;
  /** COUNT of distinct wallets holding a non-zero latest snapshot of this asset. */
  walletCount: number;
}

/** A real-time treasury exposure-vs-limit snapshot. */
export interface TreasuryExposureRecord {
  id: string;
  asset: string;
  fiatCurrency: string;
  cryptoHeld: string;
  fiatEquivalent: string;
  netExposure: string;
  exposureLimitBps: number;
  status: 'safe' | 'warning' | 'critical';
  createdAt: Date;
}

/** An immutable exposure-threshold breach alert. */
export interface TreasuryAlertRecord {
  id: string;
  asset: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  netExposure: string;
  triggeredAt: Date;
  acknowledgedAt: Date | null;
}

/** An active (not disabled) per-wallet withdrawal policy. */
export interface WithdrawalPolicyRecord {
  id: string;
  walletId: string;
  maxWithdrawalPerTx: string | null;
  maxWithdrawalPerDay: string | null;
  requiresApproval: boolean;
  allowListMode: string;
  enabledAt: Date;
}

/** Filter for the alert feed (acknowledged?: undefined = all). */
export interface TreasuryAlertListFilter {
  acknowledged?: boolean;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ITreasuryReadRepository {
  /**
   * Aggregates custodial holdings by (wallet.network, asset). Sums the LATEST
   * snapshot per (walletId, asset) — never the append-only history — and counts
   * distinct wallets. Returns Decimals as canonical strings.
   */
  aggregateBalances(): Promise<TreasuryBalanceRecord[]>;

  /** Latest real-time exposure snapshots, one per (asset, currency). */
  listExposures(): Promise<TreasuryExposureRecord[]>;

  /**
   * Threshold-breach alerts, newest-first. When `filter.acknowledged` is set,
   * filters to acknowledged (true) / unacknowledged (false); omit for all.
   */
  listAlerts(filter: TreasuryAlertListFilter): Promise<TreasuryAlertRecord[]>;

  /**
   * Records an admin acknowledgement on an alert: sets acknowledgedAt,
   * acknowledgedByAdminId, acknowledgmentNote. Operational state only — the
   * before/after trail lives in the AuditLog.
   */
  acknowledgeAlert(
    id: string,
    adminId: string,
    note: string | undefined,
    at: Date,
  ): Promise<void>;

  /** Active per-wallet withdrawal policies (disabledAt IS NULL), newest-first. */
  listWithdrawalPolicies(): Promise<WithdrawalPolicyRecord[]>;
}
