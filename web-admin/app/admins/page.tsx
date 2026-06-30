import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { AdminsPage } from "@/components/admin/admins-page"

/**
 * /admins — admin user management. Gated by RequireAuth + the `/admin/admins`
 * web_page permission. Composition only.
 */
export default function AdminsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/admins">
          <AdminsPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
