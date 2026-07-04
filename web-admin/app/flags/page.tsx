import { AppShell } from "@/components/admin/app-shell"
import { FlagsPage } from "@/components/admin/flags-page"

/**
 * /flags — feature flags with per-cohort/percentage rollout (design §6.28).
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function FlagsRoute() {
  return (
    <AppShell>
      <FlagsPage />
    </AppShell>
  )
}
