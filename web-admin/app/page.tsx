import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { MetricsDashboard } from "@/components/admin/metrics-dashboard"

/**
 * / — the admin landing page is the operational metrics dashboard. Authenticated
 * only; the Dashboard link is always visible in the shell, so no per-page
 * web_page gate here. All roles have Metrics:read, but we still degrade
 * gracefully: a 403 shows a friendly "no metrics access" empty state rather than
 * crashing (`gracefulOnForbidden`). Composition only.
 */
export default function AdminHomePage() {
  return (
    <RequireAuth>
      <AppShell>
        <MetricsDashboard gracefulOnForbidden />
      </AppShell>
    </RequireAuth>
  )
}
