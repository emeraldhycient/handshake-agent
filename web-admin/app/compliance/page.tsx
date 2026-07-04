import { AppShell } from "@/components/admin/app-shell"
import { CompliancePage } from "@/components/admin/compliance-page"

/**
 * /compliance — the compliance console (events / AML rules / Travel Rule / reports
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function ComplianceRoute() {
  return (
    <AppShell>
      <CompliancePage />
    </AppShell>
  )
}
