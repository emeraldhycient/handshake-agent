import { Skeleton } from "@/components/ui/skeleton"
import { useTicketOrders } from "@/lib/query/hooks"

import { OrderRow } from "./order-row"

/** Skeleton row matching the recent-orders grid, for the loading branch. */
function OrderRowSkeleton() {
  return (
    <div className="grid w-full grid-cols-[1.6fr_1fr_0.9fr_0.8fr] items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="ml-auto h-3.5 w-20" />
      <Skeleton className="ml-auto h-5 w-16 rounded-full" />
    </div>
  )
}

/** Right panel — Recent orders (ticket type/id · user · amount · status). Read-only. */
export function RecentOrdersCard() {
  const { data, isLoading, isError, isSuccess, refetch } = useTicketOrders()
  const orders = data?.items ?? []

  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <div className="border-b border-line px-[18px] py-[14px] text-[13px] font-extrabold text-ink">
        Recent orders
      </div>

      {/* Loading — skeleton rows matching the orders grid. */}
      {isLoading && (
        <div aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <OrderRowSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error — tokened inline error with a retry affordance. */}
      {isError && (
        <div className="p-[40px] text-center">
          <p className="text-[13px] font-bold text-tdn">
            Couldn&apos;t load orders
          </p>
          <p className="mt-1 text-[12px] text-ink3">
            The ticketing order feed is unavailable right now.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 inline-flex h-8 items-center rounded-[9px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty — design-consistent empty state. */}
      {isSuccess && orders.length === 0 && (
        <div className="p-[50px] text-center text-[13px] text-ink3">
          No ticket orders yet.
        </div>
      )}

      {/* Data. */}
      {isSuccess &&
        orders.map((order) => <OrderRow key={order.id} order={order} />)}
    </div>
  )
}
