import { cn } from "@/lib/utils"
import type { LoadMoreButtonProps } from "@/types"

/** Shared classes for every paginator button; per-site shape comes via className. */
const BASE =
  "border border-border text-[13px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"

/**
 * Canonical "Load more" / "Show more" paginator button. Disabled while pending
 * (showing `pendingLabel`); the caller supplies the shape via `className`.
 */
export function LoadMoreButton({
  onClick,
  isPending,
  label,
  pendingLabel = "Loading…",
  ariaLabel,
  className,
}: LoadMoreButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-label={ariaLabel}
      className={cn(BASE, className)}
    >
      {isPending ? pendingLabel : label}
    </button>
  )
}
