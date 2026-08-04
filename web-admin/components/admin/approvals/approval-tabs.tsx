import { cn } from "@/lib/utils"
import type { ApprovalTabsProps, AprTab } from "@/types"

/** The bucket tabs (Awaiting me · My requests); counts come from the inbox read. */
export function ApprovalTabs({
  tab,
  awaitingCount,
  myCount,
  onSelect,
}: ApprovalTabsProps) {
  const buckets: readonly [AprTab, string, number][] = [
    ["awaiting", "Awaiting me", awaitingCount],
    ["mine", "My requests", myCount],
  ]
  return (
    <div
      className="mb-4 flex gap-[9px]"
      role="tablist"
      aria-label="Approval buckets"
    >
      {buckets.map(([id, label, count]) => {
        const active = tab === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(id)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-[10px] border px-[15px] text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "border-btn-dark bg-btn-dark text-white"
                : "border-line bg-card text-ink2 hover:bg-hov"
            )}
          >
            {label}
            <span
              className={cn(
                "rounded-full px-[7px] py-px text-[10px] tabular-nums",
                active ? "bg-white/20 text-white" : "bg-card2 text-ink3"
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
