import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { MetricsDashboard } from "@/components/admin/metrics-dashboard"

/**
 * /metrics — the operational metrics dashboard (Phase 5, FINAL). Gated by
 * RequireAuth + the `/admin/metrics` web_page permission. Composition only.
 */
export default function MetricsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/metrics">
          <MetricsDashboard />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
