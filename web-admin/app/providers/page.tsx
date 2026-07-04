import { AppShell } from "@/components/admin/app-shell"
import { ProvidersPage } from "@/components/admin/providers-page"

/**
 * /providers — provider registry + mock→live readiness (design §6.27), WIRED to
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function ProvidersRoute() {
  return (
    <AppShell>
      <ProvidersPage />
    </AppShell>
  )
}
