import { AppShell } from "@/components/admin/app-shell"
import { OperatorDashboard } from "@/components/admin/operator-dashboard"

/**
 * / — the admin landing page is the operator-console "Dashboard" (design §6.1). It is a
 * pixel-faithful reproduction of the imported design with the design's own mock content
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function AdminHomePage() {
  return (
    <AppShell>
      <OperatorDashboard />
    </AppShell>
  )
}
