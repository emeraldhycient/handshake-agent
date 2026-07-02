"use client"

/**
 * TicketsPage — the operator ticketing surface (design §6.21), rebuilt 1:1 against
 * `docs/design-ref/screens/Ticketing.html`.
 *
 * Layout: a `1fr 1.4fr` row — **Vendor ports** (shape-gap note) | **Recent orders**
 * (event/id · user · amount · status). Order rows are pure read-only display (plain
 * mono text, no navigation), matching the design markup.
 *
 * DATA (Phase 6a → Phase 8):
 *  • **Recent orders** reads the REAL engine feed via `useTicketOrders()` →
 *    `TicketOrderListResponse` (id/userId/vendorKey/ticketType/quantity/totalAmount/
 *    paymentStatus/settlementStatus/deliveryStatus/createdAt), with the four async
 *    branches (loading / error / empty / data). The design's own mock `ORDER_ROWS`
 *    const is gone.
 *  • **Vendor ports** no longer fabricates per-vendor rows: there is NO vendor-port
 *    registry endpoint (only single `ticketing.enabled` + `ticketing.commissionBps`
 *    settings keys), so instead of inventing `ticketing.eventbrite`/`ticketing.tix`
 *    rows the panel now renders an HONEST shape-gap note. Wiring it needs a backend
 *    registry enrichment (deferred).
 *
 * Contract → design mapping (`TicketOrderItem` has no event/title and no user display
 * name): the bold order line renders `ticketType`, the mono id renders `id`, the user
 * cell shows the `userId` uuid (no name join yet), and the amount formats `totalAmount`
 * (canonical NGN string). The pill maps from `settlementStatus`. These missing fields
 * (event title, user name) render gracefully and are recorded as shape gaps.
 *
 * Read-only — nothing here moves money (§3.1).
 */
import { StatusPill } from "@/components/admin/status-pill"
import { Skeleton } from "@/components/ui/skeleton"
import { useTicketOrders } from "@/lib/query/hooks"
import type { TicketOrderItem } from "@handshake-agent/contracts"
import type { TicketOrderStatus } from "@/types/components"

/**
 * The engine's `settlementStatus` → the design's `StatusPill` status. Unknown/other
 * values fold onto a neutral in-flight pill so no row renders without a pill.
 */
const SETTLEMENT_STATUS: Record<string, TicketOrderStatus> = {
  settled: "settled",
  pending: "pending_settlement",
  pending_settlement: "pending_settlement",
  refunded: "refunded",
  failed: "failed",
}

// ─── Formatting ─────────────────────────────────────────────────────────────────────

const EM_DASH = "—"

/** Format the canonical NGN decimal string as a "₦45,000.00" amount (never a float). */
function formatNgn(amount: string): string {
  const n = Number(amount)
  if (Number.isNaN(n)) return amount
  return `₦${n.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Map a settlement status onto the pill; unknown values → neutral in-flight. */
function orderPillStatus(order: TicketOrderItem): TicketOrderStatus {
  return SETTLEMENT_STATUS[order.settlementStatus] ?? "pending_settlement"
}

// ─── Cards ────────────────────────────────────────────────────────────────────────

/**
 * Left panel — Vendor ports. There is NO vendor-port registry endpoint yet (only the
 * single `ticketing.enabled` + `ticketing.commissionBps` settings keys), so instead
 * of fabricating per-vendor rows this panel renders an HONEST shape-gap note. Wiring
 * it needs a backend registry enrichment (deferred).
 */
function VendorPortsCard() {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Vendor ports
      </div>
      <div className="rounded-[12px] border border-dashed border-line2 px-4 py-6 text-center">
        <p className="text-[13px] font-bold text-ink">
          No vendor-port registry yet
        </p>
        <p className="mt-1 text-[12px] leading-snug text-ink2">
          There is no vendor-port registry endpoint to enumerate ticketing
          vendors — only the global <span className="font-mono">ticketing</span>{" "}
          enablement + commission settings. Per-vendor status will appear here
          once a backend registry is added.
        </p>
      </div>
    </div>
  )
}

/** One recent-order row — event/id · user · amount · status. Read-only display. */
function OrderRow({ order }: { order: TicketOrderItem }) {
  return (
    <div className="grid w-full grid-cols-[1.6fr_1fr_0.9fr_0.8fr] items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0">
      <div>
        {/* The list item has no event/title — the bold line shows the ticket type. */}
        <div className="text-[12.5px] font-bold text-ink">
          {order.ticketType || EM_DASH}
        </div>
        <div className="font-mono text-[10.5px] text-ink3">{order.id}</div>
      </div>
      {/* User — list item exposes only the id (no display-name join yet). */}
      <div className="truncate font-mono text-[12px] text-ink2">
        {order.userId}
      </div>
      <div className="text-right font-mono text-[12px] font-bold text-ink tabular-nums">
        {formatNgn(order.totalAmount)}
      </div>
      <div className="text-right">
        <StatusPill
          status={orderPillStatus(order)}
          stuck={orderPillStatus(order) === "pending_settlement"}
        />
      </div>
    </div>
  )
}

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

/** Right panel — Recent orders (event/id · user · amount · status). Read-only. */
function RecentOrdersCard() {
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

// ─── Page ───────────────────────────────────────────────────────────────────────────

export function TicketsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Ticketing
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Vendor ports, event catalog, orders and vendor payout reconciliation.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[1fr_1.4fr]">
        <VendorPortsCard />
        <RecentOrdersCard />
      </div>
    </div>
  )
}
