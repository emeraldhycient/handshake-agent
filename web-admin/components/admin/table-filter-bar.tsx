import { cn } from "@/lib/utils"
import type { TableFilterBarProps } from "@/types"

/**
 * TableFilterBar — the shared filter/search strip that lives INSIDE a table card,
 * as its first child above the column-header row, so the controls read as part of
 * the table header rather than a detached row floating above the card. One strip
 * component keeps the look cohesive across every list screen (audit, ledger, users,
 * pricing preview). It renders the container only; each page passes its own controls
 * (search input, FilterSelect, date pickers, currency selector) as children.
 *
 * Uses the same `bg-card2` shade as the column-header row so the two bands merge into
 * a single header block, separated by a hairline. Pure layout — no state.
 */
export function TableFilterBar({ children, className }: TableFilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-[10px] border-b border-line bg-card2 px-[18px] py-[13px]",
        className
      )}
    >
      {children}
    </div>
  )
}
