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

/**
 * A per-child receive address + its gas-sweep state (Phase 6b). `address`,
 * `network` come from the real Wallet row; `balance` (native gas) + `status` +
 * `lastSweptAt` are the operational sweep view. `balance` is a canonical string.
 */
export interface TreasurySweepRecord {
  id: string;
  address: string;
  network: string;
  asset: string;
  balance: string;
  status: 'swept' | 'pending' | 'below_threshold';
  lastSweptAt: Date | null;
}

/** The sweep feed + the configured threshold (native-asset amount + its symbol). */
export interface TreasurySweepFeed {
  rows: TreasurySweepRecord[];
  sweepThreshold: string;
  thresholdAsset: string;
}

/**
 * A pending outbound settlement awaiting release (Phase 6b, READ-ONLY): a
 * processor payout or on-chain send that has not completed. `amount` is the
 * outbound asset amount; `fiatAmount` is the NGN leg when the asset is crypto,
 * else null. Both are canonical strings; `submittedAt` is a `Date`.
 */
export interface TreasuryPayoutQueueRecord {
  id: string;
  transactionId: string;
  beneficiaryLabel: string;
  reference: string;
  method: string;
  asset: string;
  amount: string;
  fiatAmount: string | null;
  requiresApproval: boolean;
  submittedAt: Date;
}

/**
 * The platform fiat-float position for one currency (Phase 6b): the running
 * `balance` of the platform_float ledger account vs a configured `targetFloat`.
 * `utilizationBps` = balance/target in bps; `status` is derived; the caller
 * supplies the configured target + low-float floor (config is a service concern).
 */
export interface TreasuryFiatFloatRecord {
  currency: string;
  balance: string;
}

/**
 * A signed net inventory position per (asset, fiat) valued in the fiat currency
 * (Phase 6b), carrying the underlying exposure limit + net for the headroom
 * derivation. Amounts are canonical strings; `exposureLimitBps` is the configured
 * inventory cap in bps.
 */
export interface TreasuryFxPositionRecord {
  asset: string;
  fiatCurrency: string;
  netPositionFiat: string;
  netExposure: string;
  fiatEquivalent: string;
  exposureLimitBps: number;
  status: 'safe' | 'warning' | 'critical';
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

  /**
   * Child-address gas-sweep view (Phase 6b): per-child receive address + native
   * gas balance + sweep lifecycle, newest-first. `sweepThreshold` /
   * `thresholdAsset` describe the configured gas-sweep floor.
   */
  listSweeps(): Promise<TreasurySweepFeed>;

  /**
   * Pending outbound settlements awaiting release (Phase 6b, READ-ONLY): payouts
   * + on-chain sends that have not completed, newest-first. Never releases funds.
   */
  listPayoutQueue(): Promise<TreasuryPayoutQueueRecord[]>;

  /**
   * A single pending payout-queue item by its opaque id (Phase 7 — the approve
   * maker-checker needs the item's transactionId + reference to raise the change
   * request). Returns null when the id is unknown or no longer pending. READ-ONLY —
   * never releases funds.
   */
  findPayoutQueueItem(id: string): Promise<TreasuryPayoutQueueRecord | null>;

  /**
   * Running platform_float ledger balance per fiat currency (Phase 6b). Returns
   * the raw balances; the service applies the configured target + threshold.
   */
  listFiatFloat(): Promise<TreasuryFiatFloatRecord[]>;

  /**
   * Signed net FX inventory positions per (asset, fiat) with the underlying
   * exposure fields (Phase 6b) — the service derives direction + headroom.
   */
  listFxPositions(): Promise<TreasuryFxPositionRecord[]>;
}
