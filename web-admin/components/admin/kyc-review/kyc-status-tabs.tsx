import { cn } from "@/lib/utils"
import { MISSING, TABS } from "@/constants/kyc-review"
import type { KycStatusTabsProps } from "@/types/components"

/** The status pill-tabs — one per bucket, each with a live count badge (design). */
export function KycStatusTabs({
  active,
  counts,
  onSelect,
}: KycStatusTabsProps) {
  return (
    <div
      className="mb-3.5 flex flex-wrap gap-[9px]"
      role="tablist"
      aria-label="KYC status"
    >
      {TABS.map((tab) => {
        const isActive = active === tab.id
        const count = counts[tab.id]
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-[10px] border px-3.5 text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isActive
                ? "border-btn-dark bg-btn-dark text-white"
                : "border-line bg-card text-ink2 hover:bg-hov"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-[7px] py-px text-[10.5px] tabular-nums",
                isActive ? "bg-white/20 text-white" : "bg-card2 text-ink3"
              )}
            >
              {count ?? MISSING}
            </span>
          </button>
        )
      })}
    </div>
  )
}
