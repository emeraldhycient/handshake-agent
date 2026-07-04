import { AppShell } from "@/components/admin/app-shell"
import { OpsPage } from "@/components/admin/ops-page"

/**
 * /ops — system/ops: provider board, webhook queues, background jobs & cron
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function OpsRoute() {
  return (
    <AppShell>
      <OpsPage />
    </AppShell>
  )
}
