import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { AdminsPage } from "@/components/admin/admins-page"

/**
 * /admins — the "Admins & roles" design surface. Gated by RequireAuth (auth still
 * works) inside the AppShell chrome. No RequirePermission gate: this is a
 * design-reproduction screen and must be viewable. Composition only.
 */
export default function AdminsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <AdminsPage />
      </AppShell>
    </RequireAuth>
  )
}
