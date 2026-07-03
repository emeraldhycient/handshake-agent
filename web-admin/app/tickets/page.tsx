import { AppShell } from "@/components/admin/app-shell"
import { TicketsPage } from "@/components/admin/tickets-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function TicketsRoute() {
  return (
    <AppShell>
      <TicketsPage />
    </AppShell>
  )
}
