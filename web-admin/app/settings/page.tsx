import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { SettingsPage } from "@/components/admin/settings-page"

/**
 * /settings — the layered-config (AppSetting) console (design §6.30). Gated by
 * RequireAuth + AppShell only; the design reproduction is intentionally viewable
 * (no RequirePermission gating). Composition only.
 */
export default function SettingsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <SettingsPage />
      </AppShell>
    </RequireAuth>
  )
}
