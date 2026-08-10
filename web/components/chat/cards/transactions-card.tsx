"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useLoadMoreTransactions } from "@/lib/query/hooks"
import { LoadMoreButton } from "@/components/shared/load-more-button"
import { TransactionDetailModal } from "@/components/shared/transaction-detail-modal"
import type { TransactionRow } from "@/lib/schemas"
import type { TransactionsCardProps } from "@/types"

/**
 * TransactionsCard — chat card for a transaction-history query result.
 * Lists rows (date · type · signed amount · status) with in/out color cues
 * (never color alone — the +/- sign carries the meaning too), a "Show more"
 * control that keyset-pages the SAME frozen window, and a download link to the
 * signed PDF statement. Tokens only, no hex literals.
 */
export function TransactionsCard({
  windowLabel,
  rows,
  totalCount,
  downloadUrl,
  from,
  to,
  txType,
  hasMore,
  nextCursor,
  density,
  className,
}: TransactionsCardProps) {
  const isMobile = density === "mobile"

  // Local UI state: rows accumulate as the user pages; the cursor/hasMore track
  // the frozen window's position. Seeded from the server's first page.
  const [extraRows, setExtraRows] = useState<TransactionRow[]>([])
  const [cursor, setCursor] = useState<string | null>(nextCursor)
  const [more, setMore] = useState<boolean>(hasMore)
  // Selected row → opens the shared TransactionDetailModal (GET /transactions/:id),
  // mirroring the Activity page/tab so chat history rows drill into full detail.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const loadMore = useLoadMoreTransactions()

  const allRows = extraRows.length ? [...rows, ...extraRows] : rows

  function onShowMore() {
    if (!cursor) return
    // `mutate` (not `mutateAsync`) so a failed page surfaces via `isError`
    // instead of an unhandled rejection; success appends + advances the cursor.
    loadMore.mutate(
      { from, to, txType, cursor },
      {
        onSuccess: (page) => {
          setExtraRows((prev) => [...prev, ...page.rows])
          setCursor(page.nextCursor)
          setMore(page.hasMore)
        },
      }
    )
  }

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        isMobile
          ? "w-[88%] rounded-[20px] shadow-card"
          : "w-[92%] rounded-[16px]",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <p className="text-[12px] font-bold tracking-widest text-muted-foreground-subtle uppercase">
          Transactions
        </p>
        <span className="text-[12px] text-muted-foreground">{windowLabel}</span>
      </div>

      {allRows.length === 0 ? (
        <p className="px-4 pb-4 text-[13.5px] text-muted-foreground">
          No transactions in this period.
        </p>
      ) : (
        <ul className="px-2 pb-1">
          {allRows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                data-tx-id={r.id}
                onClick={() => setSelectedId(r.id)}
                aria-label={`View ${r.type} transaction details`}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-3 rounded-[12px] px-2 py-2.5 text-left",
                  "transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                )}
              >
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-foreground">
                    {r.type.toUpperCase()}
                  </span>
                  <span className="block text-[12px] text-muted-foreground-subtle">
                    {r.sub} · {r.status}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex-none text-[13.5px] font-bold tabular-nums",
                    r.direction === "in" ? "text-success" : "text-foreground"
                  )}
                >
                  {r.amount}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {more && (
        <div className="px-4 pb-1">
          <LoadMoreButton
            onClick={onShowMore}
            isPending={loadMore.isPending}
            label={`Show more (${allRows.length} of ${totalCount})`}
            ariaLabel="Show more transactions"
            className="w-full rounded-[10px] py-2"
          />
        </div>
      )}

      {loadMore.isError && (
        <p role="alert" className="px-4 pb-1 text-[11.5px] text-danger">
          Couldn&apos;t load more. Tap Show more to retry.
        </p>
      )}

      <div
        className={cn(isMobile ? "px-4 pt-2 pb-4" : "px-[15px] pt-2 pb-[15px]")}
      >
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block w-full bg-accent text-center font-bold text-accent-foreground shadow-cta",
            isMobile
              ? "rounded-[14px] py-3.5 text-[15px]"
              : "rounded-[12px] py-3 text-[14px]"
          )}
        >
          Download statement (PDF)
        </a>
      </div>

      {/* Drill into a single transaction's full detail (shared with Activity). */}
      <TransactionDetailModal
        transactionId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
