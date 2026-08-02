import type { MetricsFilterState } from "@/types"

/** Transaction-capability scope options for the metrics filter. */
export const CAPABILITY_OPTIONS = [
  { value: "", label: "All capabilities" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "send", label: "Send" },
  { value: "swap", label: "Swap" },
  { value: "ticket_purchase", label: "Tickets" },
]

/** KYC-tier scope options for the metrics filter. */
export const TIER_OPTIONS = [
  { value: "", label: "All tiers" },
  { value: "unverified", label: "Unverified" },
  { value: "tier_1", label: "Tier 1" },
  { value: "tier_2", label: "Tier 2" },
  { value: "tier_3", label: "Tier 3" },
]

/** The neutral filter the "Clear" affordance resets to (last-30-days, no scoping). */
export const RESET_FILTER: MetricsFilterState = {
  presetId: "30d",
  from: "",
  to: "",
  capability: "",
  tier: "",
  currency: "",
}

// Shared control classes (kept identical across the date labels + selects).
export const DATE_LABEL_CLASS =
  "flex h-[34px] items-center gap-2 rounded-[10px] border border-line bg-card px-2.5 text-[12px] text-ink2"
export const DATE_INPUT_CLASS = "bg-transparent text-[12.5px] text-ink outline-none"
export const SELECT_CLASS = "h-[34px] w-auto min-w-0 text-[12.5px]"
