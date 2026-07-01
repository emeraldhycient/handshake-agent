import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { OperatorDashboard } from "@/components/admin/operator-dashboard"

/**
 * / — the admin landing page is the operator-console "Dashboard" (design §6.1). It is a
 * pixel-faithful reproduction of the imported design with the design's own mock content
 * embedded (no real-data wiring yet; that is a separate later step). Authenticated only
 * — the Dashboard link is always visible in the shell, so no per-page permission gate.
 * Composition only.
 */
export default function AdminHomePage() {
  return (
    <RequireAuth>
      <AppShell>
        <OperatorDashboard />
      </AppShell>
    </RequireAuth>
  )
}
