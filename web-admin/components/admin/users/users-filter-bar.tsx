"use client"

import { cn } from "@/lib/utils"
import { FilterSelect } from "@/components/admin/filter-select"
import { TableFilterBar } from "@/components/admin/table-filter-bar"
import {
  FILTER_SELECT_CLASS,
  KYC_OPTIONS,
  RISK_DEFS,
  TIER_OPTIONS,
} from "@/constants/users"
import type { UsersFilterBarProps } from "@/types/components"

/** The Users-directory filter row: search + KYC/tier selects + risk chips. */
export function UsersFilterBar({
  search,
  onSearchChange,
  kyc,
  onKycChange,
  tier,
  onTierChange,
  risk,
  onToggleRisk,
}: UsersFilterBarProps) {
  return (
    <TableFilterBar>
      <div className="flex h-[38px] min-w-[230px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
        <svg
          width="15"
          height="15"
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
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Name, email, phone…"
          aria-label="Search users by name, email or phone"
          className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
        />
      </div>

      <FilterSelect
        label="Filter by KYC status"
        options={KYC_OPTIONS}
        value={kyc}
        onChange={(e) => onKycChange(e.target.value)}
        className={FILTER_SELECT_CLASS}
      />
      <FilterSelect
        label="Filter by tier"
        options={TIER_OPTIONS}
        value={tier}
        onChange={(e) => onTierChange(e.target.value)}
        className={FILTER_SELECT_CLASS}
      />

      {RISK_DEFS.map((r) => {
        const active = risk === r.value
        return (
          <button
            key={r.value}
            type="button"
            aria-pressed={active}
            onClick={() => onToggleRisk(r.value)}
            className={cn(
              "flex h-[38px] items-center gap-[6px] rounded-[11px] border px-[13px] text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "border-btn-dark bg-btn-dark text-white"
                : "border-line bg-card text-ink2 hover:bg-hov"
            )}
          >
            {r.label}
          </button>
        )
      })}
    </TableFilterBar>
  )
}
