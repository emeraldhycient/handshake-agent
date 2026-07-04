/**
 * Metrics date-range helper shared by the dashboard range switchers (operator +
 * metrics screens). Lives in `lib/` so both components resolve ONE implementation
 * (root §13.2) — the two screens previously carried duplicate copies, and a bug in
 * that copy (date-only bounds) had to be fixed in two places.
 *
 * A preset resolves to a ROLLING window of the last `days` days ending NOW. Both
 * bounds are FULL ISO timestamps — NOT date-only strings. A date-only `to` floored to
 * midnight-of-today, which excluded everything created today and made a sub-day
 * ("24h") preset a zero-width `from === to` window that always returned zeros.
 */
import type { MetricsRangeQuery } from "@handshake-agent/contracts"

import type { MetricsFilterState } from "@/types/components"

const DAY_MS = 24 * 60 * 60 * 1000

/** A resolved `{ from, to }` window as full ISO-8601 timestamps. */
export interface MetricsRange {
  from: string
  to: string
}

/** Quick range presets (rolling windows) offered alongside a custom date range. */
export const METRICS_RANGE_PRESETS = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
] as const

/** Sentinel preset id meaning "use the explicit from/to date inputs instead". */
export const CUSTOM_PRESET_ID = "custom"

/** Days for a preset id; defaults to 30 for unknown/custom ids. */
function presetDays(id: string): number {
  return METRICS_RANGE_PRESETS.find((p) => p.id === id)?.days ?? 30
}

/**
 * Build a rolling `{ from, to }` window of the last `days` days, ending at this
 * instant. The backend filters `createdAt` in `[from, to]`, so a `to` of now (not
 * midnight-of-today) is what includes the current day's transactions.
 */
export function rangeForDays(days: number): MetricsRange {
  const to = new Date()
  const from = new Date(to.getTime() - days * DAY_MS)
  return { from: from.toISOString(), to: to.toISOString() }
}

/**
 * Resolve a filter-bar state into the `MetricsRangeQuery` the API expects. A
 * `custom` preset with BOTH date inputs set uses those dates as full-day UTC bounds
 * (start-of-day `from`, end-of-day `to` — so the chosen `to` day is included);
 * otherwise a rolling preset window is used. Non-empty capability/tier/currency are
 * added; empty selections are omitted so the backend treats them as "all".
 */
export function metricsQueryFromFilter(
  state: MetricsFilterState
): MetricsRangeQuery {
  const useCustom =
    state.presetId === CUSTOM_PRESET_ID && state.from !== "" && state.to !== ""
  const range: MetricsRange = useCustom
    ? {
        from: `${state.from}T00:00:00.000Z`,
        to: `${state.to}T23:59:59.999Z`,
      }
    : rangeForDays(presetDays(state.presetId))

  const query: MetricsRangeQuery = { from: range.from, to: range.to }
  if (state.capability) query.capability = state.capability
  if (state.tier) query.tier = state.tier
  if (state.currency) query.currency = state.currency
  return query
}
