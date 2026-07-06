import { cn } from "@/lib/utils"
import type { CursorPaginatorProps } from "@/types/components"

const BTN =
  "h-8 rounded-[9px] border border-line bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:bg-hov focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"

/**
 * Keyset cursor pager (Prev / Next + page number) — the offset `Pagination`
 * primitive needs a total the cursor feed doesn't provide, so this is the
 * design-tokened equivalent shared by keyset-paginated admin surfaces.
 */
export function CursorPaginator({
  pageIndex,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: CursorPaginatorProps) {
  return (
    <nav
      aria-label="Pagination"
      className="mx-auto mt-2 flex items-center justify-between gap-3 border-t border-line2 px-1 pt-3"
    >
      <span className="text-xs text-ink3 tabular-nums">Page {pageIndex}</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Previous page"
          className={cn(BTN, !canPrev && "pointer-events-none opacity-45")}
        >
          Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          aria-label="Next page"
          className={cn(BTN, !canNext && "pointer-events-none opacity-45")}
        >
          Next
        </button>
      </div>
    </nav>
  )
}
