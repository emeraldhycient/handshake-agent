"use client"

import { cn } from "@/lib/utils"
import { PRICING_GRID } from "@/constants/pricing"
import { formatFiat } from "@/lib/format"
import type { SpreadTableRowProps } from "@/types"

/**
 * One body row of the spread grid: capability, asset/ccy pair, spread, fee, the editable
 * per-(capability × asset × currency) MIN/MAX fiat bounds, the effective-rate preview +
 * operator-only margin, and the inline Edit pill.
 */
export function SpreadTableRow({
  row,
  onEdit,
  onEditMin,
  onEditMax,
}: SpreadTableRowProps) {
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
        PRICING_GRID
      )}
    >
      <div className="font-mono text-[12px] font-bold text-ink">{row.cap}</div>
      <div className="font-mono text-[11.5px] text-ink2">{row.pair}</div>
      <div className="font-mono text-[12.5px] font-bold text-ink tabular-nums">
        {row.spread}
      </div>
      <div className="font-mono text-[11.5px] text-ink2 tabular-nums">
        {row.fee}
      </div>
      {/* Min / max — per-(capability × asset × currency) fiat bounds, each editable. */}
      <div className="flex flex-col items-start gap-0.5 font-mono text-[11px] tabular-nums">
        <button
          type="button"
          onClick={() => onEditMin(row)}
          aria-label={`Edit ${row.cap} ${row.pair} minimum`}
          className="rounded text-left transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
        >
          {row.minValue !== null ? (
            <span className="text-ink2">
              min {formatFiat(row.minValue, row.currency)}
            </span>
          ) : (
            <span className="text-ink3">+ min</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onEditMax(row)}
          aria-label={`Edit ${row.cap} ${row.pair} maximum`}
          className="rounded text-left transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
        >
          {row.maxValue !== null ? (
            <span className="text-ink2">
              max {formatFiat(row.maxValue, row.currency)}
            </span>
          ) : (
            <span className="text-ink3">+ max</span>
          )}
        </button>
      </div>
      <div className="text-[11px]">
        <div className="text-ink">
          User sees{" "}
          <span className="font-mono font-bold tabular-nums">
            {row.userRate}
          </span>
        </div>
        <div className="text-twn">
          margin{" "}
          <span className="font-mono font-bold tabular-nums">{row.margin}</span>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onEdit(row)}
          aria-label={`Edit ${row.cap} ${row.pair} spread`}
          className="inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Edit
        </button>
      </div>
    </div>
  )
}
