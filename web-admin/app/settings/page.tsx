import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { SettingsPage } from "@/components/admin/settings-page"

/**
 * /settings — the layered-config (AppSetting) console. Gated by RequireAuth + the
 * `/admin/settings` web_page permission. Composition only.
 */
export default function SettingsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/settings">
          <SettingsPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
