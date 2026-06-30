"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useLoadMoreTransactions } from "@/lib/query/hooks"
import type { TransactionRow } from "@/lib/schemas"
import type { TransactionsCardProps } from "@/types/components"

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
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-[12px] px-2 py-2.5"
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
            </li>
          ))}
        </ul>
      )}

      {more && (
        <div className="px-4 pb-1">
          <button
            type="button"
            onClick={onShowMore}
            disabled={loadMore.isPending}
            aria-label="Show more transactions"
            className={cn(
              "w-full rounded-[10px] border border-border py-2 text-[13px] font-semibold text-foreground",
              "transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {loadMore.isPending
              ? "Loading…"
              : `Show more (${allRows.length} of ${totalCount})`}
          </button>
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
    </div>
  )
}
