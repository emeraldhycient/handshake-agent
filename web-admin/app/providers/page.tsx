import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { ProvidersPage } from "@/components/admin/providers-page"

/**
 * /providers — provider registry + mock→live readiness (design §6.27), WIRED to
 * the real `GET /admin/providers` read endpoint (Phase 6b). Wrapped in RequireAuth
 * + AppShell; the endpoint itself is permission-gated server-side (§3.3).
 * Composition only.
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
