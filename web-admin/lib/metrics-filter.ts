import { FIAT_SYMBOLS } from "@/lib/format"
import { CUSTOM_PRESET_ID } from "@/lib/metrics-range"
import type { MetricsFilterState } from "@/types/components"

/** Currency options for the metrics filter: All-currencies + one per known fiat. */
export const CURRENCY_OPTIONS = [
  { value: "", label: "All currencies" },
  ...Object.keys(FIAT_SYMBOLS).map((code) => ({ value: code, label: code })),
]

/**
 * Whether the metrics filter differs from its neutral default — i.e. any scoping
 * filter (capability / tier / currency) is set, or a custom date range is chosen.
 * Drives whether the "Clear" affordance shows.
 */
export function isFilterActive(value: MetricsFilterState): boolean {
  return (
    value.capability !== "" ||
    value.tier !== "" ||
    value.currency !== "" ||
    value.presetId === CUSTOM_PRESET_ID
  )
}
