import { RefreshCwIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { QueryEmptyStateProps, QueryErrorStateProps } from "@/types"

/**
 * QueryErrorState / QueryEmptyState — the single canonical error/empty branches
 * for TanStack-Query-backed lists (activity, overview, wallet). They replace the
 * three divergent activity error/empty copies and add a real Retry affordance
 * that calls the query's refetch, so a transient network failure is recoverable
 * in-place (scenario finding: ui-consistency-states).
 *
 * Failure is high-signal → danger-token title.
 */
export function QueryErrorState({
  onRetry,
  title = "Couldn't load this",
  description = "Something went wrong. Check your connection and try again.",
  className,
}: QueryErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 p-6 text-center",
        className
      )}
    >
      <p className="text-sm font-semibold text-danger">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-1 gap-1.5"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  )
}

export function QueryEmptyState({
  title = "Nothing here yet",
  description,
  className,
}: QueryEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 p-6 text-center",
        className
      )}
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
