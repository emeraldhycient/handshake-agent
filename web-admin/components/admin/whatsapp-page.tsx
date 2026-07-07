"use client"

/**
 * WhatsAppPage — the read-only WhatsApp operator screen (design §6.20). Composition
 * only: the "Number & webhook health" card is wired to `useWhatsAppConfig` (non-secret
 * wiring + secret-PRESENCE only, never a value — §3.5); the Flows registry and the live
 * conversation monitor have no read endpoint yet and render honest shape-gap notes. The
 * screen is entirely read-only — it moves no money and takes no sensitive action.
 */
import { HealthCard } from "@/components/admin/whatsapp/health-card"
import { FlowsCard } from "@/components/admin/whatsapp/flows-card"
import { ConversationMonitorCard } from "@/components/admin/whatsapp/conversation-monitor-card"

export function WhatsAppPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          WhatsApp
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Cloud API config, Flows, live conversation monitor and delivery
          metrics.
        </p>
      </div>

      <div className="flex flex-col gap-[14px]">
        <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2">
          <HealthCard />
          <FlowsCard />
        </div>
        <ConversationMonitorCard />
      </div>
    </div>
  )
}
