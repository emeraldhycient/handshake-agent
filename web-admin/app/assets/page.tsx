import { AppShell } from "@/components/admin/app-shell"
import { AssetsPage } from "@/components/admin/assets-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function AssetsRoute() {
  return (
    <AppShell>
      <AssetsPage />
    </AppShell>
  )
}
