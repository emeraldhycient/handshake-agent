import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { AuditPage } from "@/components/admin/audit-page"

/**
 * /audit — audit log viewer, reproduced 1:1 from the operator-console design.
 * Composition only: RequireAuth + AppShell (no RequirePermission — the design
 * reproduction is viewable). The page renders the design's own mock dataset.
 */
export default function AuditRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <AuditPage />
      </AppShell>
    </RequireAuth>
  )
}
