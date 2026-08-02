"use client"

import { cn } from "@/lib/utils"
import { TONE_TILE } from "@/constants/capabilities"
import type { CapabilityRowProps } from "@/types"

/**
 * One capability kill-switch row (design §6.25): a tinted 42px icon tile, the mono label
 * + an ENABLED/DISABLED pill, a `desc · port` line, and a 52px soft toggle. The toggle is
 * a button (not a live switch) — clicking opens the maker-checker modal, never flips state.
 */
export function CapabilityRowCard({ row, onToggle }: CapabilityRowProps) {
  const labelId = `capability-${row.id}`
  return (
    <div className="flex items-center gap-4 rounded-[16px] border border-line bg-card px-5 py-4">
      <span
        className={cn(
          "flex size-[42px] flex-none items-center justify-center rounded-[11px]",
          TONE_TILE[row.tone]
        )}
        aria-hidden="true"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d={row.icon}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[9px]">
          <span
            id={labelId}
            className="font-mono text-[14px] font-extrabold text-ink"
          >
            {row.label}
          </span>
          <span
            className={cn(
              "rounded-full px-[9px] py-0.5 text-[10.5px] font-bold",
              row.on ? "bg-sok text-tok" : "bg-sdn text-tdn"
            )}
          >
            {row.on ? "ENABLED" : "DISABLED"}
          </span>
        </div>
        <div className="mt-[3px] text-[12px] text-ink3">
          {row.desc} · port: {row.provider}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={row.on}
        aria-labelledby={labelId}
        onClick={() => onToggle(row)}
        className={cn(
          "relative h-[30px] w-[52px] flex-none rounded-full transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          row.on ? "bg-brand-green" : "bg-card2"
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left]",
            row.on ? "left-[25px]" : "left-[3px]"
          )}
        />
      </button>
    </div>
  )
}
