import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { UsersPage } from "@/components/admin/users-page"

/**
 * /users — end-user directory (design reproduction). Gated by RequireAuth only
 * (auth still works); no RequirePermission so the design screen is viewable.
 * Composition only.
 */
export default function UsersRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <UsersPage />
      </AppShell>
    </RequireAuth>
  )
}
