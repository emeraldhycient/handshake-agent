import { AppShell } from "@/components/admin/app-shell"
import { TemplatesPage } from "@/components/admin/templates-page"

/**
 * /templates — email (Resend) + WhatsApp approved-template management
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function TemplatesRoute() {
  return (
    <AppShell>
      <TemplatesPage />
    </AppShell>
  )
}
