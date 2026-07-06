import { Skeleton } from "@/components/ui/skeleton"
import { EventRow } from "./event-row"
import type { BrowseEventsProps } from "@/types/tickets"

/** "Browse events" list — owns its four async branches over the events query. */
export function BrowseEvents({
  events,
  isLoading,
  isError,
  onQuickAction,
}: BrowseEventsProps) {
  return (
    <>
      <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-foreground">
        Browse events
      </h2>

      {isLoading && (
        <div className="overflow-hidden rounded-[16px] border border-border bg-card">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-[14px] border-t border-border px-[18px] py-[15px] first:border-t-0"
            >
              <Skeleton className="h-11 w-11 flex-none rounded-[11px]" />
              <div className="flex-1">
                <Skeleton className="mb-1.5 h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-24 rounded-[11px]" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-[14px] border border-danger/20 bg-danger/5 p-5 text-center">
          <p className="text-sm font-semibold text-danger">
            Failed to load events
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {!isLoading && !isError && events.length === 0 && (
        <p className="text-sm text-muted-foreground">No events available.</p>
      )}

      {!isLoading && !isError && events.length > 0 && (
        <div className="overflow-hidden rounded-[16px] border border-border bg-card">
          {events.map((event, idx) => (
            <EventRow
              key={event.name}
              event={event}
              idx={idx}
              onQuickAction={onQuickAction}
            />
          ))}
        </div>
      )}
    </>
  )
}
