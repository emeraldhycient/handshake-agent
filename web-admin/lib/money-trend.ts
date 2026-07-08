/**
 * Pick the currency to plot in the money-trend card. The operator's chosen
 * currency may vanish when the date range changes (currencies are never summed —
 * they are different units), so a stale or unset choice falls back to the first
 * currency (the list is pre-sorted). Callers guarantee a non-empty list (the
 * card's data branch only renders when there is at least one currency).
 */
export function resolveCurrency(
  choice: string | null,
  currencies: readonly string[]
): string {
  return choice && currencies.includes(choice) ? choice : currencies[0]
}
