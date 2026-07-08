"use client"

/**
 * NotificationsPage — the "Notifications & comms" surface (design §6.18). Orchestrator:
 * composes the broadcast composer beside the read-only delivery log. A broadcast moves no
 * money (§3.1) but is high-impact — it never sends on click (confirm modal + step-up); the
 * SERVER re-resolves the cohort size and decides dispatched-now vs queued-for-approval.
 */
import { BroadcastComposer } from "@/components/admin/notifications/broadcast-composer"
import { DeliveryLog } from "@/components/admin/notifications/delivery-log"

export function NotificationsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Notifications &amp; comms
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Delivery log, bounce/complaint rates, and the broadcast composer.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1fr_1.3fr]">
        <BroadcastComposer />
        <DeliveryLog />
      </div>
    </div>
  )
}
