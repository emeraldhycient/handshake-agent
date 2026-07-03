import { AppShell } from "@/components/admin/app-shell"
import { SettingsPage } from "@/components/admin/settings-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function SettingsRoute() {
  return (
    <AppShell>
      <SettingsPage />
    </AppShell>
  )
}
