"use client"

/**
 * MoneyTrendCard — the operator "Revenue & profit trend" chart (go-readiness #7).
 *
 * Plots one money metric (GMV / revenue / profit) for one fiat currency across the
 * selected date range, using the dependency-free {@link TrendChart}. A segmented
 * toggle picks the metric; a currency selector appears when the range spans more
 * than one fiat (currencies are never summed — they are different units). The peak
 * day is captioned with its exact, currency-formatted amount.
 *
 * Presentational only — the parent owns the `useMoneySeries` query and passes the
 * four async branches (loading / error / empty / data) as props. Nothing here moves
 * money (§3.1); this is a read-only projection.
 */
import { useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { TrendChart } from "@/components/admin/trend-chart"
import { moneySeriesPoints, peakPoint } from "@/lib/money-series-points"
import { formatFiat } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { MoneyMetric, MoneyTrendCardProps } from "@/types/components"

const METRICS: readonly { key: MoneyMetric; label: string }[] = [
  { key: "gmv", label: "GMV" },
  { key: "revenue", label: "Revenue" },
  { key: "profit", label: "Profit" },
]

/** Radius-18 card shell — matches the metrics surface's FeatureCard. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-line bg-card px-[22px] py-5">
      {children}
    </div>
  )
}

export function MoneyTrendCard({
  data,
  isLoading,
  isError,
}: MoneyTrendCardProps) {
  const [metric, setMetric] = useState<MoneyMetric>("profit")
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null)

  if (isLoading) {
    return (
      <Shell>
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-[120px] w-full rounded-[12px]" />
        </div>
      </Shell>
    )
  }

  if (isError) {
    return (
      <Shell>
        <div className="text-sm font-bold text-ink">Revenue &amp; profit</div>
        <p className="mt-3 text-[12.5px] text-tdn">
          Couldn&apos;t load the money trend. Please refresh.
        </p>
      </Shell>
    )
  }

  const currencies = data?.currencies ?? []
  const hasData = !!data && data.buckets.length > 0 && currencies.length > 0

  if (!hasData) {
    return (
      <Shell>
        <div className="text-sm font-bold text-ink">Revenue &amp; profit</div>
        <p className="mt-3 text-[12.5px] text-ink3">
          No money movement in this range.
        </p>
      </Shell>
    )
  }

  // The chosen currency may vanish when the range changes — fall back to the
  // first (currencies are sorted).
  const currency =
    currencyChoice && currencies.includes(currencyChoice)
      ? currencyChoice
      : currencies[0]

  const metricLabel = METRICS.find((m) => m.key === metric)!.label
  const points = moneySeriesPoints(data, metric, currency)
  const peak = peakPoint(points)

  return (
    <Shell>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink">Revenue &amp; profit</div>
          <div className="mt-0.5 text-xs text-ink2 tabular-nums">
            {metricLabel} by day
            {peak && (
              <>
                {" · peak "}
                <span className="font-semibold text-ink">
                  {formatFiat(peak.amount, currency)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {currencies.length > 1 && (
            <select
              aria-label="Currency"
              value={currency}
              onChange={(e) => setCurrencyChoice(e.target.value)}
              className="cursor-pointer rounded-[8px] border border-line bg-card px-2 py-1.5 text-[12px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <div
            role="group"
            aria-label="Metric"
            className="flex rounded-[10px] border border-line bg-card p-[3px]"
          >
            {METRICS.map((m) => {
              const active = m.key === metric
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMetric(m.key)}
                  className={cn(
                    "cursor-pointer rounded-[7px] px-2.5 py-1 text-[12px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    active ? "bg-btn-dark text-white" : "text-ink2 hover:text-ink"
                  )}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

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
    </Shell>
  )
}
