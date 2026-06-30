import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { Dashboard } from "@/components/admin/dashboard"

/**
 * / — admin dashboard. Authenticated-only; the dashboard link is always visible
 * in the shell, so no per-page web_page gate here. Composition only.
 */
export default function AdminHomePage() {
  return (
    <RequireAuth>
      <AppShell>
        <Dashboard />
      </AppShell>
    </RequireAuth>
  )
}
