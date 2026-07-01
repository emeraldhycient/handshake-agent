import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { TicketsPage } from "@/components/admin/tickets-page"

/**
 * /tickets — the operator ticketing surface (design §6.21). Gated by RequireAuth +
 * AppShell only (no RequirePermission, so the design reproduction is viewable).
 * Composition only.
 */
export default function TicketsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <TicketsPage />
      </AppShell>
    </RequireAuth>
  )
}
