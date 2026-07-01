import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { ProvidersPage } from "@/components/admin/providers-page"

/**
 * /providers — provider ports + mock→live readiness (design §6.27). A design
 * reproduction: wrapped in RequireAuth + AppShell (auth still works) but NOT
 * permission-gated, so the reproduced screen is always viewable. Composition only.
 */
export default function ProvidersRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <ProvidersPage />
      </AppShell>
    </RequireAuth>
  )
}
