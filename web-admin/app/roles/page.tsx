import { AppShell } from "@/components/admin/app-shell"
import { RolesPage } from "@/components/admin/roles-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function RolesRoute() {
  return (
    <AppShell>
      <RolesPage />
    </AppShell>
  )
}
