/**
 * Pure helpers that resolve a backend money time-series (`MoneySeriesMetrics`,
 * per-day / per-currency GMV·revenue·profit) into a single-currency series a chart
 * can draw. No React, no fetching — the query hook owns the data; this only shapes
 * it. Amounts stay as exact decimal strings for display; a parallel numeric `value`
 * is derived solely for chart geometry (pixel positions tolerate float precision).
 */
import type { MoneySeriesMetrics } from "@handshake-agent/contracts"
import type { MoneyMetric, MoneySeriesPoint } from "@/types"

/** The exact amount of `currency` in a per-currency array, or "0" when absent. */
function amountFor(
  entries: readonly { currency: string; amount: string }[],
  currency: string
): string {
  return entries.find((e) => e.currency === currency)?.amount ?? "0"
}

/**
 * One point per bucket for the chosen metric + currency, in the buckets' order
 * (the backend sorts them ascending by date). Days where the currency did not
 * contribute to the metric are zero-filled so the line stays continuous.
 */
export function moneySeriesPoints(
  data: MoneySeriesMetrics,
  metric: MoneyMetric,
  currency: string
): MoneySeriesPoint[] {
  return data.buckets.map((bucket) => {
    const amount = amountFor(bucket[metric], currency)
    return { date: bucket.date, amount, value: Number(amount) }
  })
}

/** The point with the largest value (for a "peak day" caption), or null if empty. */
export function peakPoint(points: MoneySeriesPoint[]): MoneySeriesPoint | null {
  if (points.length === 0) return null
  return points.reduce((max, p) => (p.value > max.value ? p : max))
}

/** Header row for the money-series CSV export. */
export const MONEY_SERIES_CSV_HEADERS = [
  "date",
  "currency",
  "gmv",
  "revenue",
  "profit",
] as const

/**
 * Flatten the money-series into CSV rows — one row per (day × currency present
 * that day), amounts as exact decimal strings, zero-filled where a currency is
 * absent from a metric. Pairs with {@link MONEY_SERIES_CSV_HEADERS}.
 */
export function moneySeriesCsvRows(
  data: MoneySeriesMetrics
): (string | number)[][] {
  const rows: (string | number)[][] = []
  for (const bucket of data.buckets) {
    const present = new Set<string>()
    for (const arr of [bucket.gmv, bucket.revenue, bucket.profit]) {
      for (const entry of arr) present.add(entry.currency)
    }
    for (const currency of [...present].sort()) {
      rows.push([
        bucket.date,
        currency,
        amountFor(bucket.gmv, currency),
        amountFor(bucket.revenue, currency),
        amountFor(bucket.profit, currency),
      ])
    }
  }
  return rows
}
