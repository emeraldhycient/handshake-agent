import { AppShell } from "@/components/admin/app-shell"
import { WebhooksPage } from "@/components/admin/webhooks-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function WebhooksRoute() {
  return (
    <AppShell>
      <WebhooksPage />
    </AppShell>
  )
}
