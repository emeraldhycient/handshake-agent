import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { UsersPage } from "@/components/admin/users-page"

/**
 * /users — end-user management. Gated by RequireAuth + the `/admin/users`
 * web_page permission. Composition only.
 */
export default function UsersRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/users">
          <UsersPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
