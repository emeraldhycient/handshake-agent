"use client"

/**
 * MetricsDashboard — the admin operational dashboard (Phase 5, FINAL). Composition
 * only: `useMetricsDashboard` owns the filter + the three composite reads; the KPI
 * grid, volume/health/KYC cards, and the loading/error branches live in
 * `components/admin/metrics/*`.
 *
 * Read-only projections — nothing here moves money (§3.1). Four async branches:
 * loading skeletons / error / empty / data. On the ungated home page
 * (`gracefulOnForbidden`) a 403 (no Metrics grant) degrades to a friendly note (§3.3).
 */
import { PlatformKpisCard } from "@/components/admin/platform-kpis-card"
import { MoneyTrendCard } from "@/components/admin/money-trend-card"
import { MetricsFilterBar } from "@/components/admin/metrics-filter-bar"
import { KpiGrid } from "@/components/admin/metrics/kpi-grid"
import { TxnVolumeCard } from "@/components/admin/metrics/txn-volume-card"
import { ServiceHealthCard } from "@/components/admin/metrics/service-health-card"
import { KycFunnelCard } from "@/components/admin/metrics/kyc-funnel-card"
import {
  MetricsError,
  MetricsSkeleton,
} from "@/components/admin/metrics/metrics-states"
import { useMetricsDashboard } from "@/lib/hooks/use-metrics-dashboard"
import { useCurrencyFilterOptions } from "@/lib/hooks/use-currency-filter-options"
import type { MetricsDashboardProps } from "@/types/components"

export function MetricsDashboard({
  gracefulOnForbidden = false,
}: MetricsDashboardProps) {
  const { filter, setFilter, query, moneySeries, platformKpis, isForbidden } =
    useMetricsDashboard()
  const currencyOptions = useCurrencyFilterOptions()

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-[1320px] px-[30px] pt-[26px] pb-[60px]">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mb-[18px]">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">
            Operations overview
          </h1>
          <p className="mt-1.5 text-[13.5px] text-ink2">
            Live platform health, money movement, and what needs your attention.
          </p>
        </div>
        {/* ── Filter bar ────────────────────────────────────────────────────── */}
        <div className="mb-[22px]">
          <MetricsFilterBar
            value={filter}
            onChange={setFilter}
            currencyOptions={currencyOptions}
          />
        </div>

        {query.isLoading && <MetricsSkeleton />}

        {query.isError && (
          <MetricsError
            gracefulOnForbidden={gracefulOnForbidden}
            isForbidden={isForbidden}
          />
        )}

        {query.isSuccess && (
          <>
            <KpiGrid data={query.data} />
            <div className="mb-4">
              <PlatformKpisCard
                data={platformKpis.data}
                isLoading={platformKpis.isLoading}
                isError={platformKpis.isError}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
              <TxnVolumeCard data={query.data} />
              <ServiceHealthCard data={query.data} />
            </div>
            <div className="mt-4">
              <MoneyTrendCard
                data={moneySeries.data}
                isLoading={moneySeries.isLoading}
                isError={moneySeries.isError}
              />
            </div>
            <div className="mt-4">
              <KycFunnelCard data={query.data} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
