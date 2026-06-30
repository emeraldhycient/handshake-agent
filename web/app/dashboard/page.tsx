import { DashboardExperience } from "@/components/desktop/dashboard-experience"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { RequireVerified } from "@/components/auth/RequireVerified"

/**
 * /dashboard route — delegates entirely to DashboardExperience.
 * Kept as a direct, single-surface route so Playwright E2E can navigate here.
 *
 * Gated: unauthenticated users → /login (RequireAuth).
 *        authenticated but unverified → /onboarding (RequireVerified).
 */
export default function DashboardPage() {
  return (
    <RequireAuth>
      <RequireVerified>
        <DashboardExperience />
      </RequireVerified>
    </RequireAuth>
  )
}
