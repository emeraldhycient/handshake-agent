import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { OpsPage } from "@/components/admin/ops-page"

/**
 * /ops — system/ops: provider board, webhook queues, background jobs & cron
 * (design §6.29). Wrapped in RequireAuth + AppShell (auth still works); no
 * RequirePermission gating so the design reproduction stays viewable.
 * Composition only.
 */
export default function OpsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <OpsPage />
      </AppShell>
    </RequireAuth>
  )
}
