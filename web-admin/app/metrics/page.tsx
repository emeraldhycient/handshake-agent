import { AppShell } from "@/components/admin/app-shell"
import { MetricsDashboard } from "@/components/admin/metrics-dashboard"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function MetricsRoute() {
  return (
    <AppShell>
      <MetricsDashboard />
    </AppShell>
  )
}
