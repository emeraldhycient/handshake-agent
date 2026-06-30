import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { WhatsAppConfigPage } from "@/components/admin/whatsapp-config-page"

/**
 * /whatsapp — the read-only WhatsApp configuration view. Gated by RequireAuth +
 * the `/admin/whatsapp` web_page permission. Composition only.
 */
export default function WhatsAppRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/whatsapp">
          <WhatsAppConfigPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
