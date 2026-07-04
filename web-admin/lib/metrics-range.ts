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
const DAY_MS = 24 * 60 * 60 * 1000

/** A resolved `{ from, to }` window as full ISO-8601 timestamps. */
export interface MetricsRange {
  from: string
  to: string
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
