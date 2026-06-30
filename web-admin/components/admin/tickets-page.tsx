"use client"

/**
 * TicketsPage — a read-only list of existing ticket orders (Phase 4). There is no
 * tickets module yet; this only projects `TicketOrder` rows. Ticketing enablement
 * + commission are tuned on the Settings page (Tickets category) — a hint links
 * there. Nothing here moves money (§3.1).
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** Map a payment/settlement/delivery status to a badge variant. */
function statusVariant(
  status: string
): React.ComponentProps<typeof Badge>["variant"] {
  const value = status.toLowerCase()
  if (
    value.includes("fail") ||
    value.includes("reject") ||
    value.includes("cancel")
  ) {
    return "destructive"
  }
  if (
    value.includes("complete") ||
    value.includes("settled") ||
    value.includes("delivered") ||
    value.includes("paid") ||
    value.includes("success")
  ) {
    return "default"
  }
  return "secondary"
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  )
}

export function TicketsPage() {
  const orders = useTicketOrders()

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Tickets
        </h1>
      </div>

      <div
        role="note"
        className="rounded-[14px] border border-info/30 bg-info/5 px-4 py-3 text-sm text-info-foreground"
      >
        Ticketing enablement and commission are edited on the{" "}
        <a href="/settings" className="font-medium underline">
          Settings page
        </a>{" "}
        (Tickets category). This is a read-only list of existing orders.
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {orders.isLoading && <LoadingRows />}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {orders.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load ticket orders
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────────── */}
      {orders.isSuccess && orders.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No ticket orders yet.</p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────────── */}
      {orders.isSuccess && orders.data.items.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
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
              {orders.data.items.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {order.id.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {order.userId.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="text-foreground">
                    {order.vendorKey}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {order.ticketType}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {order.quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
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
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(order.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
