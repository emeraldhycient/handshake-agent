"use client"

import { useMemo, useState } from "react"

import {
  useDashboardMetrics,
  useMoneySeries,
  usePlatformKpis,
} from "@/lib/query/hooks"
import { metricsQueryFromFilter } from "@/lib/metrics-range"
import { ApiError } from "@/lib/api/client"
import { DEFAULT_METRICS_FILTER } from "@/constants/metrics"
import type { MetricsFilterState } from "@/types"

/**
 * The metrics dashboard's data layer: a filter-bar state that resolves into a single
 * range query driving three composite reads (dashboard summary, money series, platform
 * KPIs). Read-only projections — nothing here moves money (§3.1). `isForbidden`
 * distinguishes a 403 (no Metrics grant) so the ungated home can degrade gracefully.
 */
export function useMetricsDashboard() {
  const [filter, setFilter] = useState<MetricsFilterState>(
    DEFAULT_METRICS_FILTER
  )
  const rangeQuery = useMemo(() => metricsQueryFromFilter(filter), [filter])

  const query = useDashboardMetrics(rangeQuery)
  const moneySeries = useMoneySeries(rangeQuery)
  const platformKpis = usePlatformKpis(rangeQuery)
  const isForbidden =
    query.error instanceof ApiError && query.error.status === 403

  return { filter, setFilter, query, moneySeries, platformKpis, isForbidden }
}
