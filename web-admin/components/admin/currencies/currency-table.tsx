import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { CURRENCY_GRID } from "@/constants/currencies"
import type { CurrencyTableProps } from "@/types/components"

import { CurrencyRow } from "./currency-row"

/** The catalog table card — column header + the four async branches (design §6.24). */
export function CurrencyTable({
  isLoading,
  isError,
  isSuccess,
  rows,
  onToggle,
  onRetry,
}: CurrencyTableProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      {/* Column header row (design grid) */}
      <div
        className={cn(
          "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
          CURRENCY_GRID
        )}
      >
        <div>Currency</div>
        <div>Symbol</div>
        <div>Rounding</div>
        <div>Name-enquiry</div>
        <div>Live</div>
      </div>

      {/* Loading */}
      {isLoading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "grid items-center gap-3 border-b border-line2 px-[18px] py-[14px]",
              CURRENCY_GRID
            )}
            aria-busy="true"
          >
            <div className="flex items-center gap-[11px]">
              <Skeleton className="size-[34px] flex-none rounded-[9px]" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-2.5 w-24" />
              </div>
            </div>
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-10 rounded-full" />
          </div>
        ))}

      {/* Error */}
      {isError && (
        <div className="px-5 py-[52px] text-center">
          <div className="text-[14px] font-bold text-tdn">
            Couldn&apos;t load the currency catalog
          </div>
          <div className="mt-1 text-[12.5px] text-ink2">
            The catalog failed to load. Check your connection and try again.
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex h-[34px] items-center rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {isSuccess && rows.length === 0 && (
        <div className="px-5 py-[60px] text-center text-ink3">
          <div className="text-[14px] font-bold text-ink2">
            No currencies in the catalog
          </div>
          <div className="mt-1 text-[12.5px]">
            Currencies are added through the layered config.
          </div>
        </div>
      )}

      {/* Rows */}
      {isSuccess &&
        rows.map((row) => (
          <CurrencyRow key={row.id} row={row} onToggle={onToggle} />
        ))}
    </div>
  )
}
