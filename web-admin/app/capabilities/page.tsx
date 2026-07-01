import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { CapabilitiesPage } from "@/components/admin/capabilities-page"

/**
 * /capabilities — the Capabilities / service-registry master switchboard (design
 * §6.25). Wrapped in RequireAuth + AppShell (auth still works); no RequirePermission
 * so the design reproduction is viewable. Composition only.
 */
export default function CapabilitiesRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <CapabilitiesPage />
      </AppShell>
    </RequireAuth>
  )
}
