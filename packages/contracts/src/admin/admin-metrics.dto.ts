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

// Revenue: platform fee revenue per currency (the `platform_float` fee legs) and
// spread per currency. Spread is folded into the fx rate and NOT separately
// ledgered, so it is reported as an empty array (see metrics-read repo comment).
// Amounts are canonical decimal strings; txnCount is the count of COMPLETED txns.
export const RevenueMetricsSchema = z.object({
  totalFeesByCurrency: z.array(
    z.object({
      currency: z.string(),
      amount: z.string(),
    }),
  ),
  totalSpreadByCurrency: z.array(
    z.object({
      currency: z.string(),
      amount: z.string(),
    }),
  ),
  txnCount: z.number(),
});
export type RevenueMetrics = z.infer<typeof RevenueMetricsSchema>;

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
