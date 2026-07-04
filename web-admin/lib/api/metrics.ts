/**
 * Typed admin-metrics API clients (Phase 5, FINAL) — the READ-ONLY operational
 * dashboard. Each function parses its query through the request schema before the
 * request fires and parses the response through the response schema after (§3.3 /
 * §8: the FE gate is UX, never the only check; shapes that cross the boundary come
 * from contracts). Nothing here moves money (§3.1) — these are aggregations only.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  DashboardSummarySchema,
  KycFunnelMetricsSchema,
  MetricsOpsSchema,
  MetricsRangeQuerySchema,
  MoneySeriesMetricsSchema,
  RevenueMetricsSchema,
  TxnVolumeMetricsSchema,
  type DashboardSummary,
  type KycFunnelMetrics,
  type MetricsOps,
  type MetricsRangeQuery,
  type MoneySeriesMetrics,
  type RevenueMetrics,
  type TxnVolumeMetrics,
} from "@handshake-agent/contracts"

import { api } from "./client"

/**
 * GET /admin/metrics/dashboard — the composite summary (txn volume, revenue, KYC
 * funnel, active users, service health) for the (defaulted/clamped) date range.
 */
export async function getDashboardMetrics(
  range?: MetricsRangeQuery
): Promise<DashboardSummary> {
  const params = MetricsRangeQuerySchema.parse(range ?? {})
  const res = await api.get("/admin/metrics/dashboard", { params })
  return DashboardSummarySchema.parse(res.data)
}

/** GET /admin/metrics/transactions — per-type counts + daily series + success rate. */
export async function getTransactionMetrics(
  range?: MetricsRangeQuery
): Promise<TxnVolumeMetrics> {
  const params = MetricsRangeQuerySchema.parse(range ?? {})
  const res = await api.get("/admin/metrics/transactions", { params })
  return TxnVolumeMetricsSchema.parse(res.data)
}

/** GET /admin/metrics/revenue — platform fee + spread revenue per currency. */
export async function getRevenueMetrics(
  range?: MetricsRangeQuery
): Promise<RevenueMetrics> {
  const params = MetricsRangeQuerySchema.parse(range ?? {})
  const res = await api.get("/admin/metrics/revenue", { params })
  return RevenueMetricsSchema.parse(res.data)
}

/**
 * GET /admin/metrics/money-series — the daily per-currency GMV / revenue / profit
 * time-series for the range (feeds the operator revenue & profit trend chart).
 */
export async function getMoneySeriesMetrics(
  range?: MetricsRangeQuery
): Promise<MoneySeriesMetrics> {
  const params = MetricsRangeQuerySchema.parse(range ?? {})
  const res = await api.get("/admin/metrics/money-series", { params })
  return MoneySeriesMetricsSchema.parse(res.data)
}

/** GET /admin/metrics/kyc-funnel — point-in-time user counts by status + tier. */
export async function getKycFunnelMetrics(): Promise<KycFunnelMetrics> {
  const res = await api.get("/admin/metrics/kyc-funnel")
  return KycFunnelMetricsSchema.parse(res.data)
}

/**
 * GET /admin/metrics/ops — operational-health signals for the dashboard's three
 * still-mock panels: per-provider system health (+ webhook-queue depth + recon
 * drift), the live-activity feed, and the open-compliance-cases count.
 */
export async function getMetricsOps(): Promise<MetricsOps> {
  const res = await api.get("/admin/metrics/ops")
  return MetricsOpsSchema.parse(res.data)
}
