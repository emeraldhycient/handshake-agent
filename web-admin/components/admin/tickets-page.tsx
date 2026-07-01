"use client"

/**
 * TicketsPage — the operator ticketing surface (design §6.21), rebuilt 1:1 against
 * `docs/design-ref/screens/Ticketing.html`.
 *
 * Layout: a `1fr 1.4fr` row — **Vendor ports** (mono name + commission + status pill)
 * | **Recent orders** (event/id · user · amount · status). Clickable order rows
 * navigate to the transaction detail route, matching the design's record affordance.
 *
 * DATA: this is a DESIGN REPRODUCTION — nothing is fetched. Both panels render the
 * design's own representative sample content (module-level consts, matching the
 * `seed()` dataset shapes: vendor ports from the capability seed, buyer names like
 * "Amara Okeke"). Real-data reintegration is a separate later step. Read-only — nothing
 * here moves money (§3.1).
 */
import { useRouter } from "next/navigation"

import { StatusPill } from "@/components/admin/status-pill"
import { Badge } from "@/components/ui/badge"
import type {
  TicketOrderRow,
  TicketVendorPort,
  TicketVendorStatus,
} from "@/types/components"

// ─── Vendor-port status → the canonical status-pill token pair (§5) ───────────────
// Not a transaction/KYC status, so it maps onto Badge variants directly (StatusPill
// only knows the stMeta/kycMeta keys). Colour is never the sole signal — the label
// carries the state.
const VENDOR_VARIANT: Record<
  TicketVendorStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  live: "success",
  paused: "warn",
  onboarding: "info",
}

const VENDOR_LABEL: Record<TicketVendorStatus, string> = {
  live: "Live",
  paused: "Paused",
  onboarding: "Onboarding",
}

// ─── Design-reproduction mock content (matches the seed() dataset) ────────────────

/** Vendor ports — from the design's capability seed (`ticketing.<vendor>` ports). */
const VENDOR_ROWS: readonly TicketVendorPort[] = [
  { name: "ticketing.eventbrite", commission: "6.5%", status: "live" },
  { name: "ticketing.tix", commission: "5.0%", status: "onboarding" },
]

/** Recent orders — representative sample content shaped like the design markup. */
const ORDER_ROWS: readonly TicketOrderRow[] = [
  {
    event: "Afrobeats Live · Lagos",
    id: "tkt_80231",
    user: "Amara Okeke",
    amt: "₦45,000.00",
    status: "settled",
  },
  {
    event: "Detty December Fest",
    id: "tkt_80244",
    user: "Chidi Adeyemi",
    amt: "₦120,000.00",
    status: "pending_settlement",
  },
  {
    event: "Tech Summit '26 · Abuja",
    id: "tkt_80257",
    user: "Ngozi Balogun",
    amt: "₦18,500.00",
    status: "refunded",
  },
  {
    event: "Comedy Night · Port Harcourt",
    id: "tkt_80270",
    user: "Emeka Okonkwo",
    amt: "₦9,000.00",
    status: "failed",
  },
]

// ─── Cards ────────────────────────────────────────────────────────────────────────

/** Left panel — Vendor ports (mono name + commission + status pill). */
function VendorPortsCard() {
  return (
    <div className="rounded-[16px] border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Vendor ports
      </div>
      {VENDOR_ROWS.map((port) => (
        <div
          key={port.name}
          className="flex items-center gap-[11px] border-b border-line2 py-[11px] last:border-b-0"
        >
          <div className="flex-1">
            <div className="font-mono text-[12.5px] font-bold text-ink">
              {port.name}
            </div>
            <div className="text-[10.5px] text-ink3">
              commission {port.commission}
            </div>
          </div>
          <Badge variant={VENDOR_VARIANT[port.status]}>
            {VENDOR_LABEL[port.status]}
          </Badge>
        </div>
      ))}
    </div>
  )
}

/** Right panel — Recent orders (event/id · user · amount · status). */
function RecentOrdersCard({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <div className="border-b border-line px-[18px] py-[14px] text-[13px] font-extrabold text-ink">
        Recent orders
      </div>
      {ORDER_ROWS.map((order) => (
        <button
          type="button"
          key={order.id}
          onClick={() => onOpen(order.id)}
          className="grid w-full grid-cols-[1.6fr_1fr_0.9fr_0.8fr] items-center gap-3 border-b border-line2 px-[18px] py-3 text-left transition-colors last:border-b-0 hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <div>
            <div className="text-[12.5px] font-bold text-ink">
              {order.event}
            </div>
            <div className="font-mono text-[10.5px] text-ink3">{order.id}</div>
          </div>
          <div className="text-[12px] text-ink2">{order.user}</div>
          <div className="text-right font-mono text-[12px] font-bold text-ink tabular-nums">
            {order.amt}
          </div>
          <div className="text-right">
            <StatusPill
              status={order.status}
              stuck={order.status === "pending_settlement"}
            />
          </div>
        </button>
      ))}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────────

export function TicketsPage() {
  const router = useRouter()

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
        <RecentOrdersCard onOpen={(id) => router.push(`/transactions/${id}`)} />
      </div>
    </div>
  )
}
