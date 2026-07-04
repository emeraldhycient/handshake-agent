import { AppShell } from "@/components/admin/app-shell"
import { CapabilitiesPage } from "@/components/admin/capabilities-page"

/**
 * /capabilities — the Capabilities / service-registry master switchboard (design
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function CapabilitiesRoute() {
  return (
    <AppShell>
      <CapabilitiesPage />
    </AppShell>
  )
}
