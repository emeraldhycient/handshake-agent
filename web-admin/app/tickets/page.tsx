import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { TicketsPage } from "@/components/admin/tickets-page"

/**
 * /tickets — the read-only ticket-orders list. Gated by RequireAuth + the
 * `/admin/tickets` web_page permission. Composition only.
 */
export default function TicketsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/tickets">
          <TicketsPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
