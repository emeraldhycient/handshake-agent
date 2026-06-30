import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { CompliancePage } from "@/components/admin/compliance-page"

/**
 * /compliance — the compliance console (events / AML rules / Travel Rule / reports
 * / sanctions). Gated by RequireAuth + the `/admin/compliance` web_page
 * permission. Composition only.
 */
export default function ComplianceRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/compliance">
          <CompliancePage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
