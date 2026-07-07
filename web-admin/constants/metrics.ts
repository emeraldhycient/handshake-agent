import type { MetricsFilterState } from "@/types/components"

/** Fixed capability colors for the stacked/labelled volume bars (§5). */
export const VOLUME_SEGMENTS = [
  { key: "completed", label: "Completed", color: "var(--brand-green)" },
  { key: "failed", label: "Failed", color: "var(--brand-amber)" },
] as const

/** The dashboard's initial filter — a 30-day preset with no capability/tier/currency narrowing. */
export const DEFAULT_METRICS_FILTER: MetricsFilterState = {
  presetId: "30d",
  from: "",
  to: "",
  capability: "",
  tier: "",
  currency: "",
}
