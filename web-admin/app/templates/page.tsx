import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { TemplatesPage } from "@/components/admin/templates-page"

/**
 * /templates — email (Resend) + WhatsApp approved-template management
 * (operator-console design §6.19). Gated by RequireAuth + wrapped in AppShell;
 * NO RequirePermission gating so the design reproduction stays viewable.
 * Composition only.
 */
export default function TemplatesRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <TemplatesPage />
      </AppShell>
    </RequireAuth>
  )
}
