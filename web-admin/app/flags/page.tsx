import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { FlagsPage } from "@/components/admin/flags-page"

/**
 * /flags — feature flags with per-cohort/percentage rollout (design §6.28).
 * Composition only: auth + shell, then the design reproduction screen. No
 * `RequirePermission` gate — the design reproduction must be viewable.
 */
export default function FlagsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <FlagsPage />
      </AppShell>
    </RequireAuth>
  )
}
