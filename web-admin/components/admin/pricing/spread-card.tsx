"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { NativeSelect } from "@/components/ui/native-select"
import { TableFilterBar } from "@/components/admin/table-filter-bar"
import { SpreadTableRow } from "@/components/admin/pricing/spread-table-row"
import { PRICING_GRID } from "@/constants/pricing"
import type { SpreadCardProps } from "@/types/components"

/**
 * The spread card: a header strip (preview-currency select + editable processing fee)
 * over the design's 7-column spread grid with its four async branches. Each Buy/Sell row
 * routes edits (spread / min / max) through the page's shared audit chain.
 */
export function SpreadCard({
  rows,
  currencies,
  previewCurrency,
  feeLabel,
  isLoading,
  isError,
  isSuccess,
  onCurrencyChange,
  onRetry,
  onEditFee,
  onEdit,
  onEditMin,
  onEditMax,
}: SpreadCardProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <TableFilterBar>
        {/* Preview currency — drives the effective-rate preview (per-currency base rate). */}
        <label className="flex items-center gap-2 text-[12px] font-bold text-ink2">
          Preview
          <NativeSelect
            aria-label="Preview currency"
            value={previewCurrency}
            onChange={(e) => onCurrencyChange(e.target.value)}
            className="h-[36px] w-[110px] bg-card"
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="flex-1" />
        {/* Editable processing fee — in the header strip for a single cohesive control row. */}
        <div className="flex items-center gap-2 rounded-[12px] border border-line bg-card px-3 py-1.5">
          <div className="text-right">
            <div className="text-[10px] font-bold tracking-[0.05em] text-ink3 uppercase">
              Processing fee
            </div>
            <div className="font-mono text-[13px] font-bold text-ink tabular-nums">
              {feeLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onEditFee}
            aria-label="Edit processing fee"
            className="rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Edit
          </button>
        </div>
      </TableFilterBar>

      <div
        className={cn(
          "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
          PRICING_GRID
        )}
      >
        <div>Capability</div>
        <div>Asset / ccy</div>
        <div>Spread</div>
        <div>Fee</div>
        <div>Min / max</div>
        <div>Effective rate preview</div>
        <div aria-hidden="true" />
      </div>

      {isLoading && (
        <div className="divide-y divide-line2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "grid items-center gap-3 px-[18px] py-[13px]",
                PRICING_GRID
              )}
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="ml-auto h-8 w-14 rounded-[9px]" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="px-[18px] py-10 text-center">
          <p className="text-[14px] font-bold text-tdn">
            Failed to load pricing
          </p>
          <p className="mt-1 text-[12.5px] text-ink3">
            The pricing config could not be read.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {isSuccess && rows.length === 0 && (
        <div className="px-[18px] py-10 text-center">
          <p className="text-[14px] font-bold text-ink">No pricing rows</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            No priced assets are configured.
          </p>
        </div>
      )}

      {isSuccess &&
        rows.map((row) => (
          <SpreadTableRow
            key={row.id}
            row={row}
            onEdit={onEdit}
            onEditMin={onEditMin}
            onEditMax={onEditMax}
          />
        ))}
    </div>
  )
}
