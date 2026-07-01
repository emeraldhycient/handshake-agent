import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { ReconciliationPage } from "@/components/admin/reconciliation-page"

/**
 * /reconciliation — reconciliation breaks + cron status (design §6.12 Recon).
 * Gated by RequireAuth + AppShell only (design-reproduction pass: no
 * RequirePermission so the screen is viewable). Composition only.
 */
export default function ReconciliationRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <ReconciliationPage />
      </AppShell>
    </RequireAuth>
  )
}
