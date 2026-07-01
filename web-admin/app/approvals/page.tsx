import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { ApprovalsPage } from "@/components/admin/approvals-page"

/**
 * /approvals — the maker-checker approval inbox (design §6 Approvals — surfaces
 * via the Platform group). Gated by RequireAuth + wrapped in AppShell so the
 * console chrome (sidebar / top bar) frames it. Design-reproduction screen: no
 * RequirePermission gate so the queue is viewable. Composition only.
 */
export default function ApprovalsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <ApprovalsPage />
      </AppShell>
    </RequireAuth>
  )
}
