"use client"

/**
 * MoneyTrendCard — the operator "Revenue & profit trend" chart (go-readiness #7).
 *
 * Plots one money metric (GMV / revenue / profit) for one fiat currency across the
 * selected date range, using the dependency-free {@link TrendChart}. The
 * {@link MoneyTrendToolbar} picks the metric + currency; the peak day is captioned
 * with its exact, currency-formatted amount.
 *
 * Presentational only — the parent owns the `useMoneySeries` query and passes the
 * four async branches (loading / error / empty / data) as props. Metric + currency
 * state is held here (not in the data-branch subtree) so a refetch doesn't reset the
 * operator's selection. Nothing here moves money (§3.1); this is a read-only projection.
 */
import { useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { TrendChart } from "@/components/admin/trend-chart"
import { FeatureCard } from "@/components/admin/feature-card"
import { MoneyTrendToolbar } from "@/components/admin/money-trend/trend-toolbar"
import { moneySeriesPoints, peakPoint } from "@/lib/money-series-points"
import { resolveCurrency } from "@/lib/money-trend"
import { MONEY_METRICS } from "@/constants/money-trend"
import type { MoneyMetric, MoneyTrendCardProps } from "@/types"

export function MoneyTrendCard({
  data,
  isLoading,
  isError,
}: MoneyTrendCardProps) {
  const [metric, setMetric] = useState<MoneyMetric>("profit")
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null)

  if (isLoading) {
    return (
      <FeatureCard>
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-[120px] w-full rounded-[12px]" />
        </div>
      </FeatureCard>
    )
  }

  if (isError) {
    return (
      <FeatureCard>
        <div className="text-sm font-bold text-ink">Revenue &amp; profit</div>
        <p className="mt-3 text-[12.5px] text-tdn">
          Couldn&apos;t load the money trend. Please refresh.
        </p>
      </FeatureCard>
    )
  }

  const currencies = data?.currencies ?? []
  const hasData = !!data && data.buckets.length > 0 && currencies.length > 0

  if (!hasData) {
    return (
      <FeatureCard>
        <div className="text-sm font-bold text-ink">Revenue &amp; profit</div>
        <p className="mt-3 text-[12.5px] text-ink3">
          No money movement in this range.
        </p>
      </FeatureCard>
    )
  }

  const currency = resolveCurrency(currencyChoice, currencies)
  const metricLabel = MONEY_METRICS.find((m) => m.key === metric)!.label
  const points = moneySeriesPoints(data, metric, currency)
  const peak = peakPoint(points)

  return (
    <FeatureCard>
      <MoneyTrendToolbar
        data={data}
        metric={metric}
        onMetricChange={setMetric}
        metricLabel={metricLabel}
        currency={currency}
        currencies={currencies}
        onCurrencyChange={setCurrencyChoice}
        peakAmount={peak?.amount ?? null}
      />

      <div className="h-[150px]">
        <TrendChart
          ariaLabel={`${metricLabel} trend over ${points.length} days in ${currency}`}
          points={points.map((p) => ({ label: p.date, value: p.value }))}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-ink3 tabular-nums">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </FeatureCard>
  )
}
