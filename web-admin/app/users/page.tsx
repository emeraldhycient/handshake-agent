import { AppShell } from "@/components/admin/app-shell"
import { UsersPage } from "@/components/admin/users-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function UsersRoute() {
  return (
    <AppShell>
      <UsersPage />
    </AppShell>
  )
}
