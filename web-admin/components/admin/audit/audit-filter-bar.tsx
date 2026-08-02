"use client"

import { FilterSelect } from "@/components/admin/filter-select"
import { TableFilterBar } from "@/components/admin/table-filter-bar"
import { ACTION_OPTIONS, FILTER_SELECT_CLASS } from "@/constants/audit"
import type { AuditFilterBarProps } from "@/types"

/** The audit-log filter row: search (→ `subject`) + action enum + from/to date range. */
export function AuditFilterBar({
  search,
  onSearchChange,
  action,
  onActionChange,
  from,
  onFromChange,
  to,
  onToChange,
}: AuditFilterBarProps) {
  return (
    <TableFilterBar>
      <div className="flex h-[38px] min-w-[230px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
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
          placeholder="target, subject…"
          aria-label="Search audit log by target or subject"
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
        />
      </div>
      <FilterSelect
        label="Filter by action"
        options={ACTION_OPTIONS}
        value={action}
        onChange={(e) => onActionChange(e.target.value)}
        className={FILTER_SELECT_CLASS}
      />
      <label className="flex h-[38px] items-center gap-2 rounded-[11px] border border-line bg-card px-3 text-[12px] text-ink2">
        <span className="text-ink3">From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          aria-label="Filter from date"
          className="bg-transparent text-[12.5px] text-ink outline-none"
        />
      </label>
      <label className="flex h-[38px] items-center gap-2 rounded-[11px] border border-line bg-card px-3 text-[12px] text-ink2">
        <span className="text-ink3">To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          aria-label="Filter to date"
          className="bg-transparent text-[12.5px] text-ink outline-none"
        />
      </label>
    </TableFilterBar>
  )
}
