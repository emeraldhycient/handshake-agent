import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { NotificationsPage } from "@/components/admin/notifications-page"

/**
 * /notifications — the "Notifications & comms" surface (broadcast composer +
 * delivery log; design §6.18). Gated by RequireAuth + wrapped in AppShell; the
 * screen itself is a design reproduction, so no RequirePermission gate. Composition
 * only.
 */
export default function NotificationsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <NotificationsPage />
      </AppShell>
    </RequireAuth>
  )
}
