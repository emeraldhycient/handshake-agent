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

/**
 * Optional filters that narrow the txn-based aggregations. All fields are no-ops
 * when unset (or when an unknown value is supplied — the adapter validates against
 * the Prisma enums and ignores anything unrecognised). `capability` (a Transaction
 * type) and `tier` (the owning user's KYC tier) scope every txn-based metric;
 * `currency` (an ISO fiat code) scopes the money metrics (GMV / revenue / money
 * series). The point-in-time KYC funnel is a population snapshot and is unaffected.
 */
export interface MetricsFilter {
  currency?: string;
  capability?: string;
  tier?: string;
}

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
  /** Complete processing-fee revenue per currency (buy AND sell), from the Quote. */
  totalFeesByCurrency: CurrencyAmount[];
  /**
   * Realized bid-ask spread margin per currency, DERIVED per completed buy/sell
   * from its authoritative Quote snapshot (baseRate vs effective fxRate) — see
   * `tx-profit.ts` + docs §5. No longer empty: spread is not in the ledger, but it
   * IS recoverable from the Quote.
   */
  totalSpreadByCurrency: CurrencyAmount[];
  /** Total platform profit per currency = fees + spread. */
  totalProfitByCurrency: CurrencyAmount[];
  /** Count of COMPLETED transactions in the range. */
  txnCount: number;
}

/** One day of the money time-series: per-currency GMV, revenue (fees) and profit. */
export interface MoneySeriesBucketRow {
  /** ISO date (YYYY-MM-DD, UTC). */
  date: string;
  /** Fiat notional (GMV) settled that day, per currency. */
  gmv: CurrencyAmount[];
  /** Processing-fee revenue realized that day, per currency. */
  revenue: CurrencyAmount[];
  /** Total profit (fees + realized spread) that day, per currency. */
  profit: CurrencyAmount[];
}

export interface MoneySeriesResult {
  /** Sorted ascending by date; only days with a completed money-moving txn. */
  buckets: MoneySeriesBucketRow[];
  /** Distinct fiat currencies present anywhere in the range, sorted. */
  currencies: string[];
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
  transactionVolume(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<TransactionVolumeResult>;

  /**
   * Gross Merchandise Value: the summed fiat notional (`metadata.fiatAmount`) of
   * every COMPLETED, money-moving transaction whose `createdAt` is in [from, to),
   * grouped by fiat currency (`metadata.fiatCurrency`) — EXACT scaled-integer math.
   * `txnCount` is the number of completed txns that carried a fiat notional.
   */
  gmv(from: Date, to: Date, filter?: MetricsFilter): Promise<GmvResult>;

  /**
   * Platform profit for COMPLETED transactions in [from, to), grouped by currency
   * and DERIVED from each buy/sell Quote (fee + realized spread; see `tx-profit.ts`)
   * — EXACT scaled-integer math. Recovers sell fees + all spread the double-entry
   * ledger never records, so `totalSpreadByCurrency` is populated (not empty).
   * `txnCount` is completed txns in range.
   */
  revenue(from: Date, to: Date, filter?: MetricsFilter): Promise<RevenueResult>;

  /**
   * Daily money time-series over [from, to): for each UTC day with a completed
   * money-moving transaction, the per-currency GMV (fiat notional from
   * `metadata`), revenue (processing fees) and profit (fees + realized spread),
   * the latter two DERIVED from each buy/sell Quote (see `tx-profit.ts`). Buckets
   * are sorted ascending; `currencies` lists every fiat present in the range.
   * EXACT scaled-integer math — never floats.
   */
  moneySeries(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<MoneySeriesResult>;

  /**
   * Point-in-time user counts grouped by kycStatus and by kycTier (soft-deleted
   * users excluded). Not date-ranged — reflects the current population.
   */
  kycFunnel(): Promise<KycFunnelResult>;

  /**
   * Distinct users who transacted in [from, to) (active), users created in the
   * range (new), and the total non-soft-deleted user count.
   */
  activeUsers(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<ActiveUsersResult>;

  /**
   * Per transactable service (buy/sell/send/swap): total / completed / failed
   * counts in [from, to) and the success rate.
   */
  serviceHealth(
    from: Date,
    to: Date,
    filter?: MetricsFilter,
  ): Promise<ServiceHealthResult>;
}
