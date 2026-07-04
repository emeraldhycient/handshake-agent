import { AppShell } from "@/components/admin/app-shell"
import { LimitsPage } from "@/components/admin/limits-page"

/**
 * /limits — "Limits & velocity" (design §6.26): per-tier amount caps + velocity/
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function LimitsRoute() {
  return (
    <AppShell>
      <LimitsPage />
    </AppShell>
  )
}
