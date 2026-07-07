"use client"

/**
 * TicketsPage — the operator ticketing surface (design §6.21). Composition only: a
 * `1fr 1.4fr` row of Vendor ports (an honest shape-gap — no registry endpoint yet) and
 * Recent orders (wired to `useTicketOrders`), both under `components/admin/tickets/*`.
 * Read-only — nothing here moves money (§3.1).
 */
import { VendorPortsCard } from "@/components/admin/tickets/vendor-ports-card"
import { RecentOrdersCard } from "@/components/admin/tickets/recent-orders-card"

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
