"use client"

import { EDIT_ICON } from "@/constants/limits"
import type { LimitLeafRowProps } from "@/types/components"

/**
 * One key/value row. The edit pencil shows ONLY when the row is backed by an enforced,
 * editable leaf (`row.edit`) — a "—" placeholder never exposes an editor, so an
 * un-persistable (or fake) edit is impossible (§3.6).
 */
export function LimitLeafRow({ row, onEdit }: LimitLeafRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line2 py-[10px] last:border-b-0">
      <span className="text-[12.5px] text-ink2">{row.k}</span>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[13px] font-bold text-ink tabular-nums">
          {row.v}
        </span>
        {row.edit && (
          <button
            type="button"
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.k}`}
            className="flex size-[28px] items-center justify-center rounded-lg border border-line text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d={EDIT_ICON}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
