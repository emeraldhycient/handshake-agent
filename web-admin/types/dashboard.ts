/** Operator dashboard (KPIs, volume chart, health, activity) + its table primitives. */

import type { ComponentPropsWithoutRef } from "react"
import type { KpiDeltaTone } from "./shared"

// ─── Operator dashboard ──────────────────────────────────────────────────────────

/** The KPI-range switcher presets (design `kpiRanges`). */
export type DashboardRangeId = "24h" | "7d" | "30d"

/** One derived KPI tile (feeds `KpiCard`). */
export interface DashboardKpi {
  label: string
  value: string
  delta: string
  deltaNote: string
  hero?: boolean
  tone?: KpiDeltaTone
}

/** One System-health provider row (dot + halo + right-aligned status colour). */
export interface DashboardHealthRow {
  name: string
  note: string
  /** Right-aligned status label — observed latency ("120ms") or "—". */
  status: string
  dot: string
  halo: string
  /** Right-aligned status colour token. */
  fg: string
}

/** One Live-activity feed row (icon + tint + text/meta/time). */
export interface DashboardActivityItem {
  text: string
  meta: string
  time: string
  /** Inline SVG path (design `a.icon`). */
  icon: string
  iconBg: string
  iconFg: string
}

/** Dashboard header — the title + the 24h/7d/30d range switcher. */
export interface DashboardHeaderProps {
  range: DashboardRangeId
  onRangeChange: (range: DashboardRangeId) => void
}

/** The 4×2 KPI-tile grid, rendered from the real composite summary. */
export interface KpiGridProps {
  data: import("@handshake-agent/contracts").DashboardSummary
  /** Open compliance count from the ops endpoint (undefined while loading/forbidden). */
  openComplianceCases: number | undefined
}

/** The Transaction-volume chart card — real stacked-by-capability series. */
export interface VolumeChartCardProps {
  data: import("@handshake-agent/contracts").DashboardSummary | undefined
  isLoading: boolean
}

/** Shared props for the ops-endpoint cards (System health + Live activity). */
export interface DashboardOpsCardProps {
  ops: import("@handshake-agent/contracts").MetricsOps | undefined
  isLoading: boolean
  isError: boolean
}

export interface FilterSelectProps extends Omit<
  ComponentPropsWithoutRef<"select">,
  "children"
> {
  /** Accessible label (rendered as `aria-label` — the design has no visible label). */
  label: string
  /** The `{ value, label }` options rendered as `<option>`s. */
  options: readonly { value: string; label: string }[]
}

export interface PaginationProps {
  /** Total number of records across all pages (drives the "of Z" count). */
  total: number
  /** Number of records per page. */
  pageSize: number
  /** The current 1-based page. */
  page: number
  /** Change handler — receives the requested 1-based page. */
  onPageChange: (page: number) => void
  /** Optional max-width applied to the pulled-up bar (defaults to full width). */
  maxWidth?: string
}

/**
 * The canonical status strings the console renders → one semantic pill. Maps the
 * design's `stMeta` / `kycMeta` keys (logic.js lines 496/593/687/699/1829). Colour is
 * never the sole signal — the pill's label carries the state.
 */
export type StatusPillStatus =
  // stMeta (transactions / ledger)
  | "settled"
  | "pending_settlement"
  | "failed"
  | "refunded"
  | "refund"
  | "quoted"
  | "initiated"
  | "receive"
  // kycMeta (KYC / users)
  | "verified"
  | "pending"
  | "needs_info"
  | "rejected"

export interface StatusPillProps {
  /** The status string to map onto a semantic pill. */
  status: StatusPillStatus
  /** Override the rendered label (defaults to the status's canonical label). */
  label?: string
  /** Adds a pulsing `currentColor` dot for a "stuck" pending status (design line 605). */
  stuck?: boolean
}

/** One stacked capability segment in a ChartBars column (design §5 stacked bars). */
export type ChartBarCapability = "buy" | "sell" | "send" | "swap" | "ticket"

/** One bar in ChartBars: a label + the five capability values (any unit; normalised). */
export interface ChartBar {
  /** The bar's axis label / tooltip (e.g. "Jun 18"). */
  label: string
  /** The five capability segment values, index-aligned to the legend order. */
  segments: Record<ChartBarCapability, number>
}

export interface ChartBarsProps {
  /** The bars to render (left→right). */
  bars: ChartBar[]
  /** Accessible summary (rendered as the chart's `aria-label`). */
  ariaLabel: string
  /** Whether to render the 5-capability legend above the bars (default true). */
  showLegend?: boolean
}
