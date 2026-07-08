"use client"

import { cn } from "@/lib/utils"
import { LOCK_PATH, PENCIL_PATH, SETTINGS_GRID } from "@/constants/settings"
import { sourceTint } from "@/lib/settings/rows"
import type { SettingsTableRowProps } from "@/types/components"

/**
 * One body row of the settings grid: the mono key + `{type}` meta, the mono effective
 * value, the source chain-tooltip chip, the description, and the per-editability Edit
 * column (an active Edit pill for DB-layer keys, a muted "Locked" for baselines).
 */
export function SettingsTableRow({ row, onEdit }: SettingsTableRowProps) {
  const chainTitle = row.chain.join(" · ")
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
        SETTINGS_GRID
      )}
    >
      {/* Key + type meta */}
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] font-bold text-ink">
          {row.key}
        </div>
        <div className="text-[10.5px] text-ink3">{row.type}</div>
      </div>

      {/* Effective value (mono / tabular) */}
      <div
        className="truncate font-mono text-[12.5px] font-bold text-ink tabular-nums"
        title={row.val}
      >
        {row.val}
      </div>

      {/* Source chip (chain-resolution tooltip) */}
      <div>
        <span
          title={chainTitle}
          aria-label={`Source ${row.src}. Resolution — ${chainTitle}`}
          className={cn(
            "inline-flex cursor-help items-center gap-1.5 rounded-[6px] px-[9px] py-[3px] text-[10.5px] font-extrabold",
            sourceTint(row.src)
          )}
        >
          {row.src}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 16v-5M12 8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
        </span>
      </div>

      {/* Description */}
      <div className="text-[11.5px] leading-[1.35] text-ink2">{row.desc}</div>

      {/* Edit column — styled per editability */}
      <div className="text-right">
        {row.editable ? (
          <button
            type="button"
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.key}`}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d={PENCIL_PATH}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Edit
          </button>
        ) : (
          <span
            aria-label="Locked — set via ENV or JSON, not editable from the console"
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-line2 bg-card2 px-3 py-[7px] text-[11.5px] font-bold text-ink3"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d={LOCK_PATH}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Locked
          </span>
        )}
      </div>
    </div>
  )
}
