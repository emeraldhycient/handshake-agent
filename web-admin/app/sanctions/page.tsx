import { AppShell } from "@/components/admin/app-shell"
import { SanctionsPage } from "@/components/admin/sanctions-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function SanctionsRoute() {
  return (
    <AppShell>
      <SanctionsPage />
    </AppShell>
  )
}
