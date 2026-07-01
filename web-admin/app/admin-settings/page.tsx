import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { AdminSettingsPage } from "@/components/admin/admin-settings-page"

/**
 * /admin-settings — the signed-in operator's OWN profile + preferences (design
 * §6.16): profile card, 2FA status, theme + notification toggles. This is a
 * personal surface every authenticated admin has, so — like the Dashboard home —
 * it is ungated (no per-page permission; the nav shows it to everyone). The
 * design reproduction must be viewable, so it is wrapped in RequireAuth +
 * AppShell only, never RequirePermission. Composition only.
 */
export default function AdminSettingsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <AdminSettingsPage />
      </AppShell>
    </RequireAuth>
  )
}
