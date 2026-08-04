"use client"

/** UserDetailTabs — the underline tab strip that selects the active user-detail tab. */
import { cn } from "@/lib/utils"
import { TABS } from "@/constants/user-detail"
import type { UserDetailTabsProps } from "@/types"

export function UserDetailTabs({ tab, onTab }: UserDetailTabsProps) {
  return (
    <div className="scr mb-4 flex gap-[3px] overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = tab === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-none cursor-pointer border-b-2 px-[15px] py-2.5 text-[13px] font-bold whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "border-brand-amber text-ink"
                : "border-transparent text-ink3"
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
