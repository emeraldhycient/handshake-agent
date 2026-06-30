import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { NotificationsPage } from "@/components/admin/notifications-page"

/**
 * /notifications — the Comms notification-template console. Gated by RequireAuth +
 * the `/admin/notifications` web_page permission. Composition only.
 */
export default function NotificationsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/notifications">
          <NotificationsPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
