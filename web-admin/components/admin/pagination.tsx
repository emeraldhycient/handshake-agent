"use client"

/**
 * Pagination — the shared table pager (design §5 "Pagination", lines 1083-1094).
 * Sits just below the table card with a `--line2` top border. (The design tucks it
 * up with a −42px margin into the card's body padding; these repro cards have rows
 * flush to the edge, so a negative margin overlapped the last row — a small positive
 * margin keeps the pager cleanly below the table on every screen.) Left: a
 * "Showing X–Y of Z" count (tabular). Right: Prev / numbered pages (with the design's
 * ellipsis collapse from `pageNums`, logic.js 336) / Next as 32px radius-9 bordered
 * buttons; the active page uses the dark `--btn-dark` fill, Prev/Next dim at the ends.
 */
import { cn } from "@/lib/utils"
import type { PaginationProps } from "@/types"

/**
 * The design's page-number collapse (logic.js `pageNums`): ≤7 pages render in full;
 * otherwise keep the first two, last two, and the window around the current page,
 * inserting an ellipsis where the run breaks.
 */
function pageNums(current: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const keep = new Set(
    [1, 2, pages - 1, pages, current - 1, current, current + 1].filter(
      (n) => n >= 1 && n <= pages
    )
  )
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | "…")[] = []
  let prev = 0
  for (const n of sorted) {
    if (n - prev > 1) out.push("…")
    out.push(n)
    prev = n
  }
  return out
}

export function Pagination({
  total,
  pageSize,
  page,
  onPageChange,
  maxWidth,
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1
  const end = Math.min(current * pageSize, total)

  if (pages <= 1) return null

  const nums = pageNums(current, pages)
  const atStart = current <= 1
  const atEnd = current >= pages

  return (
    <nav
      aria-label="Pagination"
      className="mx-auto mt-2 flex items-center justify-between gap-3 border-t border-line2 px-1 pt-3"
      style={maxWidth ? { maxWidth } : undefined}
    >
      <span className="text-xs text-ink3 tabular-nums">
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, current - 1))}
          disabled={atStart}
          aria-label="Previous page"
          className={cn(
            "h-8 rounded-[9px] border border-line bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:bg-hov focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            atStart && "pointer-events-none opacity-45"
          )}
        >
          Prev
        </button>
        {nums.map((n, i) =>
          n === "…" ? (
            <span
              key={`gap-${i}`}
              aria-hidden
              className="px-1 text-xs text-ink3"
            >
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPageChange(n)}
              aria-label={`Page ${n}`}
              aria-current={n === current ? "page" : undefined}
              className={cn(
                "h-8 min-w-8 rounded-[9px] border px-2 text-xs font-bold tabular-nums transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                n === current
                  ? "border-btn-dark bg-btn-dark text-white"
                  : "border-line bg-card text-ink2 hover:bg-hov"
              )}
            >
              {n}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pages, current + 1))}
          disabled={atEnd}
          aria-label="Next page"
          className={cn(
            "h-8 rounded-[9px] border border-line bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:bg-hov focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            atEnd && "pointer-events-none opacity-45"
          )}
        >
          Next
        </button>
      </div>
    </nav>
  )
}
