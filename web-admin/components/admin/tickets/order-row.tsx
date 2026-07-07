import { StatusPill } from "@/components/admin/status-pill"
import { EM_DASH } from "@/constants/tickets"
import { formatNgn, orderPillStatus } from "@/lib/tickets/orders"
import type { OrderRowProps } from "@/types/components"

/** One recent-order row — ticket type / id · user · amount · status. Read-only display. */
export function OrderRow({ order }: OrderRowProps) {
  const status = orderPillStatus(order)
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
        <StatusPill status={status} stuck={status === "pending_settlement"} />
      </div>
    </div>
  )
}
