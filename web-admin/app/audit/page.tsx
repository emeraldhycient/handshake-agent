import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { AuditPage } from "@/components/admin/audit-page"

/**
 * /audit — audit log viewer + chain verification. Gated by RequireAuth + the
 * `/admin/audit` web_page permission. Composition only.
 */
export default function AuditRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/audit">
          <AuditPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
