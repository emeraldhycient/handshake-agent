/** Metrics dashboard + the money trend / KPI / filter shapes it renders. */

import type { FilterOption } from "./shared"

/** One per-currency money figure (mirrors the metrics `byCurrency` entries). */
export interface CurrencyAmount {
  currency: string
  amount: string
}

/** One point on a trend chart (an x label + a numeric y value). */
export interface TrendPoint {
  label: string
  value: number
}

/**
 * TrendChart props — a self-contained SVG line/area chart (no chart lib). Renders
 * `points` as a normalized line (optional area fill) using `currentColor`, so the
 * caller sets the hue via a `text-*` class. Empty points → an inline "No data".
 */
export interface TrendChartProps {
  points: readonly TrendPoint[]
  /** Accessible description of the series (required — the chart is an image). */
  ariaLabel: string
  /** Fill the area under the line (default true). */
  area?: boolean
  className?: string
}

/**
 * Metrics filter-bar state: the selected range preset (or "custom"), the custom
 * from/to date-only strings ('' when a preset is active), and the optional
 * capability / tier / currency filters ('' = all). Resolved into a MetricsRangeQuery
 * by `metricsQueryFromFilter`.
 */
export interface MetricsFilterState {
  presetId: string
  from: string
  to: string
  capability: string
  tier: string
  currency: string
}

/** MetricsFilterBar props — controlled: parent owns the state + resolves the query. */
export interface MetricsFilterBarProps {
  value: MetricsFilterState
  onChange: (next: MetricsFilterState) => void
  /** Currency options derived from the live catalog read (never hardcoded). */
  currencyOptions: readonly FilterOption[]
}

/**
 * PlatformKpisCard props — presentational (parent owns the `usePlatformKpis`
 * query and passes the async branches as props).
 */
export interface PlatformKpisCardProps {
  data: import("@handshake-agent/contracts").PlatformKpis | undefined
  isLoading: boolean
  isError: boolean
}

/** Which money metric a trend chart is plotting. */
export type MoneyMetric = "gmv" | "revenue" | "profit"

/**
 * MoneyTrendCard props — presentational (no fetching): the parent owns the
 * `useMoneySeries` query and passes its result down as the four async branches.
 */
export interface MoneyTrendCardProps {
  data: import("@handshake-agent/contracts").MoneySeriesMetrics | undefined
  isLoading: boolean
  isError: boolean
}

/** The money-trend card header: title + peak caption, CSV export, currency + metric pickers. */
export interface MoneyTrendToolbarProps {
  /** The resolved (non-empty) series — used for the lazy CSV export. */
  data: import("@handshake-agent/contracts").MoneySeriesMetrics
  metric: MoneyMetric
  onMetricChange: (metric: MoneyMetric) => void
  metricLabel: string
  currency: string
  currencies: string[]
  onCurrencyChange: (currency: string) => void
  /** The peak day's exact-decimal amount for the caption, or null when the series is empty. */
  peakAmount: string | null
}

/**
 * One day of a money time-series, resolved for a single currency: the exact
 * decimal `amount` (for display via `formatFiat`) and its `value` (a JS number
 * for chart geometry only — precision loss is acceptable for pixel positions).
 */
export interface MoneySeriesPoint {
  date: string
  amount: string
  value: number
}

// ─── Metrics dashboard (Phase 5, FINAL) ──────────────────────────────────────────────

export interface MetricsBarProps {
  /** Accessible label describing what this bar represents. */
  label: string
  /** The bar's value; clamped to [0, max] for the rendered width. */
  value: number
  /** The scale maximum (the 100%-width reference). Non-positive → an empty track. */
  max: number
  /** Optional right-aligned caption (e.g. the formatted value or a percentage). */
  caption?: string
}

export interface MetricsDashboardProps {
  /**
   * When true the metrics query 403 (no Metrics grant) degrades to a friendly
   * empty state instead of an error — used on the ungated home page (§3.3 UX).
   */
  gracefulOnForbidden?: boolean
}

/**
 * One KPI stat tile. Tile 0 is the dark-green `hero` (gradient + white ink + amber
 * delta chip); others use the card surface with a success/`warn` muted delta chip.
 */
export interface KpiTileProps {
  label: string
  value: string
  delta?: string
  deltaNote?: string
  footnote?: string
  hero?: boolean
  warn?: boolean
}

/** A metrics section card driven by the composite dashboard summary (read-only). */
export interface MetricsCardProps {
  data: import("@handshake-agent/contracts").DashboardSummary
}

/**
 * The metrics error branch: a real failure, or — when `gracefulOnForbidden` and the
 * failure is a 403 (`isForbidden`) — a friendly "no metrics access" note (§3.3 UX).
 */
export interface MetricsErrorProps {
  gracefulOnForbidden: boolean
  isForbidden: boolean
}
