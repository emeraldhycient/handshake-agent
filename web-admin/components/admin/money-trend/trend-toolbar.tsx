"use client"

/**
 * MoneyTrendToolbar — the money-trend card header: title + peak-day caption, a CSV
 * export, an optional currency selector (only when the range spans >1 fiat, since
 * currencies are never summed), and the GMV/Revenue/Profit segmented toggle.
 * Presentation only.
 */
import { ExportCsvButton } from "@/components/admin/export-csv-button"
import {
  moneySeriesCsvRows,
  MONEY_SERIES_CSV_HEADERS,
} from "@/lib/money-series-points"
import { formatFiat } from "@/lib/format"
import { cn } from "@/lib/utils"
import { MONEY_METRICS } from "@/constants/money-trend"
import type { MoneyTrendToolbarProps } from "@/types"

export function MoneyTrendToolbar({
  data,
  metric,
  onMetricChange,
  metricLabel,
  currency,
  currencies,
  onCurrencyChange,
  peakAmount,
}: MoneyTrendToolbarProps) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-sm font-bold text-ink">Revenue &amp; profit</div>
        <div className="mt-0.5 text-xs text-ink2 tabular-nums">
          {metricLabel} by day
          {peakAmount !== null && (
            <>
              {" · peak "}
              <span className="font-semibold text-ink">
                {formatFiat(peakAmount, currency)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ExportCsvButton
          label="Export"
          filename="money-series.csv"
          build={() => ({
            headers: MONEY_SERIES_CSV_HEADERS,
            rows: moneySeriesCsvRows(data),
          })}
        />
        {currencies.length > 1 && (
          <select
            aria-label="Currency"
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value)}
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
          {MONEY_METRICS.map((m) => {
            const active = m.key === metric
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={active}
                onClick={() => onMetricChange(m.key)}
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
  )
}
