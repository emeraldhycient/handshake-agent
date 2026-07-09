import { CUSTOM_PRESET_ID } from "@/lib/metrics-range"
import type { MetricsFilterState } from "@/types/components"

// Currency options are NOT a static list here — they derive from the live
// catalog read via `useCurrencyFilterOptions` so runtime-added fiats appear.

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
