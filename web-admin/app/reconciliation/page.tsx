import { AppShell } from "@/components/admin/app-shell"
import { ReconciliationPage } from "@/components/admin/reconciliation-page"

/**
 * /reconciliation — reconciliation breaks + cron status (design §6.12 Recon).
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function ReconciliationRoute() {
  return (
    <AppShell>
      <ReconciliationPage />
    </AppShell>
  )
}
