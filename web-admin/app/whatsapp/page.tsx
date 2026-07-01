import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { WhatsAppPage } from "@/components/admin/whatsapp-page"

/**
 * /whatsapp — the read-only WhatsApp operator screen (Cloud-API number & webhook
 * health, E2E Flows, live conversation monitor). Gated by RequireAuth + AppShell.
 * This is a pixel design reproduction (no permission gating so it stays viewable);
 * composition only.
 */
export default function WhatsAppRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <WhatsAppPage />
      </AppShell>
    </RequireAuth>
  )
}
