import { AppShell } from "@/components/admin/app-shell"
import { BlockedPage } from "@/components/admin/blocked-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function BlockedRoute() {
  return (
    <AppShell>
      <BlockedPage />
    </AppShell>
  )
}
