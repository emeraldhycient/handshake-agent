import { AppShell } from "@/components/admin/app-shell"
import { AuditPage } from "@/components/admin/audit-page"

/**
 * /audit — audit log viewer, reproduced 1:1 from the operator-console design.
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function AuditRoute() {
  return (
    <AppShell>
      <AuditPage />
    </AppShell>
  )
}
