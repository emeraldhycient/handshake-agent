"use client"

/**
 * TicketsPage — a read-only list of existing ticket orders (Phase 4). There is no
 * tickets module yet; this only projects `TicketOrder` rows. Ticketing enablement
 * + commission are tuned on the Settings page (Tickets category) — a hint links
 * there. Nothing here moves money (§3.1).
 *
 * Layout (design §6.21): 1fr / 1.4fr — Vendor ports (mono name + status pill,
 * derived from the vendors present in the orders since there is no vendor hook)
 * | Recent orders table (event/id · user · amount · status).
 *
 * Four async branches: loading / error / empty / data.
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useTicketOrders } from "@/lib/query/hooks"
import type { TicketOrderItem } from "@handshake-agent/contracts"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** Map a payment/settlement/delivery status to a status-pill variant. */
function statusVariant(
  status: string
): React.ComponentProps<typeof Badge>["variant"] {
  const value = status.toLowerCase()
  if (
    value.includes("fail") ||
    value.includes("reject") ||
    value.includes("cancel")
  ) {
    return "danger"
  }
  if (
    value.includes("complete") ||
    value.includes("settled") ||
    value.includes("delivered") ||
    value.includes("paid") ||
    value.includes("success")
  ) {
    return "success"
  }
  if (value.includes("refund") || value.includes("info")) {
    return "info"
  }
  return "warn"
}

/** Distinct vendors present in the orders, with an order count each. */
function deriveVendorPorts(
  items: readonly TicketOrderItem[]
): Array<{ vendorKey: string; count: number }> {
  const counts = new Map<string, number>()
  for (const order of items) {
    counts.set(order.vendorKey, (counts.get(order.vendorKey) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([vendorKey, count]) => ({ vendorKey, count }))
    .sort((a, b) => a.vendorKey.localeCompare(b.vendorKey))
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-3.5 lg:grid lg:grid-cols-[1fr_1.4fr]">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  )
}

/** Left panel — vendor ports derived from the orders. */
function VendorPortsCard({ items }: { items: readonly TicketOrderItem[] }) {
  const vendors = deriveVendorPorts(items)

  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-4">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Vendor ports
      </div>
      {vendors.length === 0 ? (
        <p className="py-2 text-[12px] text-ink3">No vendors yet.</p>
      ) : (
        <ul>
          {vendors.map((vendor) => (
            <li
              key={vendor.vendorKey}
              className="flex items-center gap-3 border-b border-line2 py-2.5 last:border-b-0"
            >
              <div className="flex-1">
                <div className="font-mono text-[12.5px] font-bold text-ink">
                  {vendor.vendorKey}
                </div>
                <div className="text-[10.5px] text-ink3 tabular-nums">
                  {vendor.count} {vendor.count === 1 ? "order" : "orders"}
                </div>
              </div>
              <Badge variant="neutral">Registered</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[10.5px] text-ink3">
        Commission and enablement are edited on the{" "}
        <a href="/settings" className="font-semibold text-tif underline">
          Settings page
        </a>{" "}
        (Tickets category).
      </p>
    </div>
  )
}

/** Right panel — the recent-orders table (all existing columns preserved). */
function RecentOrdersCard({ items }: { items: readonly TicketOrderItem[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="border-b border-line px-[18px] py-3.5 text-[13px] font-extrabold text-ink">
        Recent orders
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Settlement</TableHead>
            <TableHead>Delivery</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="font-mono text-xs text-ink3">
                {order.id.slice(0, 8)}…
              </TableCell>
              <TableCell className="font-mono text-xs text-ink3">
                {order.userId.slice(0, 8)}…
              </TableCell>
              <TableCell className="font-mono text-ink">
                {order.vendorKey}
              </TableCell>
              <TableCell className="text-ink2">{order.ticketType}</TableCell>
              <TableCell className="text-right tabular-nums">
                {order.quantity}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {order.totalAmount}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(order.paymentStatus)}>
                  {order.paymentStatus}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(order.settlementStatus)}>
                  {order.settlementStatus}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(order.deliveryStatus)}>
                  {order.deliveryStatus}
                </Badge>
              </TableCell>
              <TableCell className="text-ink2 tabular-nums">
                {formatDate(order.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function TicketsPage() {
  const orders = useTicketOrders()

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-4 overflow-y-auto px-[30px] py-[26px]">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Ticketing
        </h1>
        <p className="mt-1 text-[13.5px] text-ink2">
          Vendor ports, event catalog, orders and vendor payout reconciliation.
        </p>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {orders.isLoading && <LoadingRows />}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {orders.isError && (
        <div className="rounded-2xl border border-line bg-sdn/40 p-5 text-center">
          <p className="text-sm font-semibold text-tdn">
            Failed to load ticket orders
          </p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Data / Empty ─────────────────────────────────────────────────────── */}
      {orders.isSuccess && (
        <div className="flex flex-col gap-3.5 lg:grid lg:grid-cols-[1fr_1.4fr] lg:items-start">
          <VendorPortsCard items={orders.data.items} />
          {orders.data.items.length === 0 ? (
            <div className="rounded-2xl border border-line bg-card px-5 py-8 text-center">
              <p className="text-[13px] font-bold text-ink">
                No ticket orders yet
              </p>
              <p className="mt-1 text-[12px] text-ink3">
                Orders appear here once ticketing is enabled and users buy
                tickets.
              </p>
            </div>
          ) : (
            <RecentOrdersCard items={orders.data.items} />
          )}
        </div>
      )}
    </div>
  )
}
