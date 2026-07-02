/**
 * DI token and port contract for the admin metrics read repository (Phase 5 —
 * FINAL). READ-ONLY date-ranged aggregations over Transaction / LedgerEntry /
 * User / KycProfile for the operational dashboard.
 *
 * The concrete Prisma adapter lives in infrastructure and implements this
 * interface; the application layer (AdminMetricsService) depends only on this
 * contract (clean-arch §4.1, CLAUDE.md §3.2). Nothing here mutates anything — it
 * only aggregates (§3.1).
 *
 * Money sums (`amount`) are canonical decimal STRINGS computed with exact
 * scaled-integer arithmetic in the adapter — never JS floats.
 */
export const METRICS_READ_REPOSITORY = Symbol('METRICS_READ_REPOSITORY');

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

/** Per-type transaction counts with a completed/failed/stuck breakdown. */
export interface TxnTypeCount {
  type: string;
  count: number;
  completed: number;
  failed: number;
  /**
   * In-flight (non-terminal) transactions of this type — statuses
   * `pending | validating | confirmed | settling`. The sibling of `failed` so the
   * dashboard "Failed / stuck tx" card can surface BOTH, matching the sidebar
   * stuck badge semantics (same STUCK_STATUSES slice the admin txn read counts).
   */
  stuck: number;
}

/** One point in a daily transaction-count series. */
export interface TxnDailyBucket {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  count: number;
}

/** One day of the stacked-by-capability series: per-capability counts + their sum. */
export interface TxnCapabilityBucketRow {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  buy: number;
  sell: number;
  send: number;
  swap: number;
  ticket: number;
  total: number;
}

export interface TransactionVolumeResult {
  byType: TxnTypeCount[];
  series: TxnDailyBucket[];
  /** Per-UTC-day counts split across the five capabilities (buy/sell/send/swap/ticket). */
  stackedSeries: TxnCapabilityBucketRow[];
  /** completed / (completed + failed) over the range; 0 when neither occurs. */
  successRate: number;
}

/** A GMV (fiat notional) amount aggregated for one currency (canonical decimal string). */
export interface GmvResult {
  /** Summed fiat notional of completed, money-moving txns per currency. */
  totalByCurrency: CurrencyAmount[];
  /** Count of completed txns that contributed a fiat notional. */
  txnCount: number;
}

/** A money amount aggregated for one currency (canonical decimal string). */
export interface CurrencyAmount {
  currency: string;
  amount: string;
}

export interface RevenueResult {
  /** Platform fee revenue per currency (the `platform_float` fee legs). */
  totalFeesByCurrency: CurrencyAmount[];
  /**
   * Spread per currency. Spread is folded into the fx rate and NOT separately
   * ledgered, so this is always empty (see the adapter comment for why it is
   * not recoverable from the ledger).
   */
  totalSpreadByCurrency: CurrencyAmount[];
  /** Count of COMPLETED transactions in the range. */
  txnCount: number;
}

export interface CountByKey {
  key: string;
  count: number;
}

export interface KycFunnelResult {
  byStatus: CountByKey[];
  byTier: CountByKey[];
}

export interface ActiveUsersResult {
  /** Distinct users with a Transaction whose createdAt is in the range. */
  activeInRange: number;
  /** Users whose createdAt is in the range. */
  newInRange: number;
  /** Total (non-soft-deleted) users. */
  totalUsers: number;
}

export interface ServiceHealthRow {
  service: string;
  total: number;
  completed: number;
  failed: number;
  successRate: number;
}

export interface ServiceHealthResult {
  services: ServiceHealthRow[];
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IMetricsReadRepository {
  /**
   * Transactions with `createdAt` in [from, to): per-type status counts (each with
   * completed / failed / stuck breakdowns), a daily count series (date string
   * YYYY-MM-DD → count), and the overall success rate (completed / (completed +
   * failed); 0 when none). `stuck` counts the in-flight statuses
   * `pending | validating | confirmed | settling`.
   */
  transactionVolume(from: Date, to: Date): Promise<TransactionVolumeResult>;

  /**
   * Gross Merchandise Value: the summed fiat notional (`metadata.fiatAmount`) of
   * every COMPLETED, money-moving transaction whose `createdAt` is in [from, to),
   * grouped by fiat currency (`metadata.fiatCurrency`) — EXACT scaled-integer math.
   * `txnCount` is the number of completed txns that carried a fiat notional.
   */
  gmv(from: Date, to: Date): Promise<GmvResult>;

  /**
   * Sum of the platform-fee ledger legs (`platform_float` credits) for COMPLETED
   * transactions in [from, to), grouped by currency — EXACT scaled-integer math.
   * Spread is folded into the fx rate and not separately ledgered, so
   * `totalSpreadByCurrency` is always empty. `txnCount` is completed txns in range.
   */
  revenue(from: Date, to: Date): Promise<RevenueResult>;

  /**
   * Point-in-time user counts grouped by kycStatus and by kycTier (soft-deleted
   * users excluded). Not date-ranged — reflects the current population.
   */
  kycFunnel(): Promise<KycFunnelResult>;

  /**
   * Distinct users who transacted in [from, to) (active), users created in the
   * range (new), and the total non-soft-deleted user count.
   */
  activeUsers(from: Date, to: Date): Promise<ActiveUsersResult>;

  /**
   * Per transactable service (buy/sell/send/swap): total / completed / failed
   * counts in [from, to) and the success rate.
   */
  serviceHealth(from: Date, to: Date): Promise<ServiceHealthResult>;
}
