import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { RolesPage } from "@/components/admin/roles-page"

/**
 * /roles — role & permission management. Gated by RequireAuth + the
 * `/admin/roles` web_page permission. Composition only.
 */
export default function RolesRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/roles">
          <RolesPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
