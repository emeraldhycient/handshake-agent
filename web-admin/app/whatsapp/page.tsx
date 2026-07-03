import { AppShell } from "@/components/admin/app-shell"
import { WhatsAppPage } from "@/components/admin/whatsapp-page"

/**
 * /whatsapp — the read-only WhatsApp operator screen (Cloud-API number & webhook
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function WhatsAppRoute() {
  return (
    <AppShell>
      <WhatsAppPage />
    </AppShell>
  )
}
