import { z } from "zod";

// Admin metrics / dashboard DTOs (Phase 5 — FINAL) — READ-ONLY date-ranged
// aggregations over Transaction / LedgerEntry / User / KycProfile. Nothing here
// moves money (§3.1); revenue (fees + spread) is surfaced ONLY to operators on
// this admin surface, never on an end-user surface. Money sums are canonical
// decimal STRINGS computed with exact scaled-integer arithmetic — never floats.

// Date-range query: both bounds are optional ISO date strings. When omitted the
// service defaults to the last 30 days and clamps the window at 366 days.
export const MetricsRangeQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
export type MetricsRangeQuery = z.infer<typeof MetricsRangeQuerySchema>;

// One point in a daily time series: an ISO date (YYYY-MM-DD) and its count.
export const MetricsBucketSchema = z.object({
  date: z.string(),
  count: z.number(),
});
export type MetricsBucket = z.infer<typeof MetricsBucketSchema>;

// One day of the stacked-by-capability volume chart: an ISO date and the per-
// capability transaction counts for that UTC day (buy/sell/send/swap/ticket). The
// operator dashboard renders these as the stacked-bar silhouette; `total` is the
// convenience sum so the FE need not re-add the five segments.
export const TxnCapabilityBucketSchema = z.object({
  date: z.string(),
  buy: z.number(),
  sell: z.number(),
  send: z.number(),
  swap: z.number(),
  ticket: z.number(),
  total: z.number(),
});
export type TxnCapabilityBucket = z.infer<typeof TxnCapabilityBucketSchema>;

// Transaction volume: per-type counts (with completed/failed breakdown), a daily
// series of total transactions, a daily series stacked by capability (for the
// dashboard chart), and the overall success rate over the range.
export const TxnVolumeMetricsSchema = z.object({
  byType: z.array(
    z.object({
      type: z.string(),
      count: z.number(),
      completed: z.number(),
      failed: z.number(),
      // Count of stuck (in-flight, non-terminal) transactions of this type —
      // the sibling of `failed` so the dashboard "Failed / stuck tx" card can
      // show BOTH (matching the sidebar stuck badge semantics). Non-negative
      // integer; `failed` is retained unchanged.
      stuck: z.number().int().nonnegative(),
    }),
  ),
  series: z.array(MetricsBucketSchema),
  // Per-day counts split across the five capabilities — feeds the stacked-bar
  // Transaction-volume chart on the operator dashboard.
  stackedSeries: z.array(TxnCapabilityBucketSchema),
  successRate: z.number(),
});
export type TxnVolumeMetrics = z.infer<typeof TxnVolumeMetricsSchema>;

// GMV (gross merchandise value): the summed fiat notional of every COMPLETED,
// money-moving transaction in the range, grouped by fiat currency. Amounts are
// canonical decimal STRINGS computed with exact scaled-integer arithmetic — never
// floats. `txnCount` is the number of completed transactions that contributed a
// fiat notional. This is a read-only aggregation; nothing here moves money (§3.1).
export const GmvMetricsSchema = z.object({
  totalByCurrency: z.array(
    z.object({
      currency: z.string(),
      amount: z.string(),
    }),
  ),
  txnCount: z.number(),
});
export type GmvMetrics = z.infer<typeof GmvMetricsSchema>;

// Revenue: platform profit per currency, DERIVED from the authoritative Quote
// snapshot of each completed buy/sell (safe, ledger-non-invasive — see
// docs/go-readiness-program.md §5 and the metrics-read repo). `totalFeesByCurrency`
// is the complete processing fee (buy AND sell), `totalSpreadByCurrency` is the
// realized bid-ask spread margin (no longer empty), and `totalProfitByCurrency` is
// their sum. Amounts are canonical decimal strings; txnCount = COMPLETED txns.
const CurrencyAmountSchema = z.object({
  currency: z.string(),
  amount: z.string(),
});
export const RevenueMetricsSchema = z.object({
  totalFeesByCurrency: z.array(CurrencyAmountSchema),
  totalSpreadByCurrency: z.array(CurrencyAmountSchema),
  totalProfitByCurrency: z.array(CurrencyAmountSchema),
  txnCount: z.number(),
});
export type RevenueMetrics = z.infer<typeof RevenueMetricsSchema>;

// One day of the money time-series: an ISO UTC date (YYYY-MM-DD) and the per-
// currency GMV, revenue (processing fees) and profit (fees + realized spread)
// realized that day. Amounts are canonical decimal STRINGS (exact scaled-integer
// arithmetic — never floats). Only days with at least one completed money-moving
// transaction appear; the FE zero-fills gaps at chart time.
export const MoneySeriesBucketSchema = z.object({
  date: z.string(),
  gmv: z.array(CurrencyAmountSchema),
  revenue: z.array(CurrencyAmountSchema),
  profit: z.array(CurrencyAmountSchema),
});
export type MoneySeriesBucket = z.infer<typeof MoneySeriesBucketSchema>;

// The daily money time-series for the range: the sorted (ascending) per-day
// buckets plus the distinct fiat currencies present anywhere in the range (sorted)
// so the FE can build a currency selector without re-scanning every bucket. Feeds
// the operator "Revenue & profit trend" chart. Read-only; nothing moves money (§3.1).
export const MoneySeriesMetricsSchema = z.object({
  buckets: z.array(MoneySeriesBucketSchema),
  currencies: z.array(z.string()),
});
export type MoneySeriesMetrics = z.infer<typeof MoneySeriesMetricsSchema>;

// KYC funnel: user counts grouped by kycStatus and by kycTier (point-in-time, not
// date-ranged — the funnel reflects the current population).
export const KycFunnelMetricsSchema = z.object({
  byStatus: z.array(
    z.object({
      status: z.string(),
      count: z.number(),
    }),
  ),
  byTier: z.array(
    z.object({
      tier: z.string(),
      count: z.number(),
    }),
  ),
});
export type KycFunnelMetrics = z.infer<typeof KycFunnelMetricsSchema>;

// Active users: distinct users who transacted in the range, users created in the
// range, and the total user population.
export const ActiveUsersMetricsSchema = z.object({
  activeInRange: z.number(),
  newInRange: z.number(),
  totalUsers: z.number(),
});
export type ActiveUsersMetrics = z.infer<typeof ActiveUsersMetricsSchema>;

// Service health: per transactable service (buy/sell/send/swap) the total,
// completed, failed counts and the success rate over the range.
export const ServiceHealthMetricsSchema = z.object({
  services: z.array(
    z.object({
      service: z.string(),
      total: z.number(),
      completed: z.number(),
      failed: z.number(),
      successRate: z.number(),
    }),
  ),
});
export type ServiceHealthMetrics = z.infer<typeof ServiceHealthMetricsSchema>;

// The composite dashboard payload — every metric block for one date range.
export const DashboardSummarySchema = z.object({
  txnVolume: TxnVolumeMetricsSchema,
  gmv: GmvMetricsSchema,
  revenue: RevenueMetricsSchema,
  kycFunnel: KycFunnelMetricsSchema,
  activeUsers: ActiveUsersMetricsSchema,
  serviceHealth: ServiceHealthMetricsSchema,
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
