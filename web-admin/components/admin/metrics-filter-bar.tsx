"use client"

/**
 * MetricsFilterBar — the operator metrics filter strip (go-readiness #7). Quick
 * range presets (7/30/90d) + a custom From/To date range, plus capability / tier /
 * currency selectors that scope every dashboard aggregation. Controlled: the parent
 * owns the state and resolves it into a query via `metricsQueryFromFilter`.
 *
 * Reuses the canonical FilterSelect + native date inputs (the audit/ledger pattern),
 * so the metrics filters read the same as every other list screen. Presentational —
 * no fetching, no query building.
 */
import { FilterSelect } from "@/components/admin/filter-select"
import { METRICS_RANGE_PRESETS, CUSTOM_PRESET_ID } from "@/lib/metrics-range"
import { FIAT_SYMBOLS } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { MetricsFilterBarProps } from "@/types/components"

const CAPABILITY_OPTIONS = [
  { value: "", label: "All capabilities" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "send", label: "Send" },
  { value: "swap", label: "Swap" },
  { value: "ticket_purchase", label: "Tickets" },
]

const TIER_OPTIONS = [
  { value: "", label: "All tiers" },
  { value: "unverified", label: "Unverified" },
  { value: "tier_1", label: "Tier 1" },
  { value: "tier_2", label: "Tier 2" },
  { value: "tier_3", label: "Tier 3" },
]

const CURRENCY_OPTIONS = [
  { value: "", label: "All currencies" },
  ...Object.keys(FIAT_SYMBOLS).map((code) => ({ value: code, label: code })),
]

const DATE_LABEL_CLASS =
  "flex h-[34px] items-center gap-2 rounded-[10px] border border-line bg-card px-2.5 text-[12px] text-ink2"
const DATE_INPUT_CLASS = "bg-transparent text-[12.5px] text-ink outline-none"
const SELECT_CLASS = "h-[34px] w-auto min-w-0 text-[12.5px]"

export function MetricsFilterBar({ value, onChange }: MetricsFilterBarProps) {
  const hasActiveFilter =
    value.capability !== "" ||
    value.tier !== "" ||
    value.currency !== "" ||
    value.presetId === CUSTOM_PRESET_ID

  const set = (patch: Partial<typeof value>) => onChange({ ...value, ...patch })

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* Quick range presets */}
      <div
        role="group"
        aria-label="Date range preset"
        className="flex rounded-[11px] border border-line bg-card p-[3px]"
      >
        {METRICS_RANGE_PRESETS.map((p) => {
          const active = p.id === value.presetId
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => set({ presetId: p.id, from: "", to: "" })}
              className={cn(
                "cursor-pointer rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                active ? "bg-btn-dark text-white" : "text-ink2 hover:text-ink"
              )}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Custom date range */}
      <label className={DATE_LABEL_CLASS}>
        <span className="text-ink3">From</span>
        <input
          type="date"
          value={value.from}
          onChange={(e) =>
            set({ presetId: CUSTOM_PRESET_ID, from: e.target.value })
          }
          aria-label="Filter from date"
          className={DATE_INPUT_CLASS}
        />
      </label>
      <label className={DATE_LABEL_CLASS}>
        <span className="text-ink3">To</span>
        <input
          type="date"
          value={value.to}
          onChange={(e) =>
            set({ presetId: CUSTOM_PRESET_ID, to: e.target.value })
          }
          aria-label="Filter to date"
          className={DATE_INPUT_CLASS}
        />
      </label>

      {/* Filters */}
      <FilterSelect
        label="Filter by capability"
        options={CAPABILITY_OPTIONS}
        value={value.capability}
        onChange={(e) => set({ capability: e.target.value })}
        className={SELECT_CLASS}
      />
      <FilterSelect
        label="Filter by KYC tier"
        options={TIER_OPTIONS}
        value={value.tier}
        onChange={(e) => set({ tier: e.target.value })}
        className={SELECT_CLASS}
      />
      <FilterSelect
        label="Filter by currency"
        options={CURRENCY_OPTIONS}
        value={value.currency}
        onChange={(e) => set({ currency: e.target.value })}
        className={SELECT_CLASS}
      />

      {hasActiveFilter && (
        <button
          type="button"
          onClick={() =>
            onChange({
              presetId: "30d",
              from: "",
              to: "",
              capability: "",
              tier: "",
              currency: "",
            })
          }
          className="cursor-pointer rounded-[9px] px-2.5 py-1.5 text-[12px] font-bold text-ink2 underline-offset-2 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Clear
        </button>
      )}
    </div>
  )
}
