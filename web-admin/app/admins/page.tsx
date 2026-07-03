import { AppShell } from "@/components/admin/app-shell"
import { AdminsPage } from "@/components/admin/admins-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function AdminsRoute() {
  return (
    <AppShell>
      <AdminsPage />
    </AppShell>
  )
}
