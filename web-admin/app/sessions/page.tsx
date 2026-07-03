import { AppShell } from "@/components/admin/app-shell"
import { SessionsPage } from "@/components/admin/sessions-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function SessionsRoute() {
  return (
    <AppShell>
      <SessionsPage />
    </AppShell>
  )
}
