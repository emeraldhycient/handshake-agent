"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { TxnRow } from "@/components/admin/transactions/txn-row"
import { GRID } from "@/constants/transactions"
import type { TxnLedgerProps } from "@/types"

const COLUMNS = [
  "ID",
  "Type",
  "User",
  "Amount",
  "Status",
  "Idempotency key",
  "Created",
] as const

/**
 * The 7-column master ledger (Txns.html lines 9-23). Owns its four async
 * branches; rows delegate to `TxnRow` and open the detail route via `onOpen`.
 */
export function TxnLedger({
  rows,
  isLoading,
  isError,
  isSuccess,
  search,
  onRetry,
  onOpen,
}: TxnLedgerProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div
        className={cn(
          "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
          GRID
        )}
      >
        {COLUMNS.map((c) => (
          <div key={c} className={c === "Amount" ? "text-right" : undefined}>
            {c}
          </div>
        ))}
      </div>

      {isLoading && (
        <div aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "grid min-h-[50px] items-center gap-3 border-b border-line2 px-[18px] last:border-b-0",
                GRID
              )}
            >
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="ml-auto h-3.5 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="p-[40px] text-center">
          <p className="text-[13px] font-bold text-tdn">
            Couldn&apos;t load transactions
          </p>
          <p className="mt-1 text-[12px] text-ink3">
            The engine oversight feed is unavailable right now.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex h-8 items-center rounded-[9px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {isSuccess && rows.length === 0 && (
        <div className="p-[50px] text-center text-[13px] text-ink3">
          {search.trim()
            ? "No transactions match this search."
            : "No transactions match this view."}
        </div>
      )}

      {isSuccess &&
        rows.map((t) => (
          <TxnRow key={t.id} txn={t} onOpen={() => onOpen(t.id)} />
        ))}
    </div>
  )
}
