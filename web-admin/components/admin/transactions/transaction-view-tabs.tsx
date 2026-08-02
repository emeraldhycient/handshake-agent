"use client"

import { cn } from "@/lib/utils"
import { TX_VIEWS, VIEW_COUNT_KEY } from "@/constants/transactions"
import type { TransactionViewTabsProps } from "@/types"

/** The four view tabs (with count pills) + the id/hash/ref search input. */
export function TransactionViewTabs({
  view,
  counts,
  search,
  onSelectView,
  onSearch,
}: TransactionViewTabsProps) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2">
      {TX_VIEWS.map((v) => {
        const active = view === v.id
        const count = counts?.[VIEW_COUNT_KEY[v.id]]
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelectView(v.id)}
            aria-pressed={active}
            className={cn(
              "flex h-9 items-center gap-[7px] rounded-[10px] border px-3.5 text-[12.5px] font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "border-btn-dark bg-btn-dark text-white"
                : "border-line bg-card text-ink2 hover:bg-hov"
            )}
          >
            {v.label}
            {count !== undefined && (
              <span
                className={cn(
                  "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-extrabold tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-card2 text-ink3"
                )}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
      <div className="flex-1" />
      <label className="flex h-9 min-w-[200px] items-center gap-2 rounded-[10px] border border-line bg-card px-3">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="text-ink3"
        >
          <circle
            cx="11"
            cy="11"
            r="7"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="m20 20-3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="id, hash, ref…"
          aria-label="Search transactions by id, hash or ref"
          className="min-w-0 flex-1 border-none bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink3"
        />
      </label>
    </div>
  )
}
