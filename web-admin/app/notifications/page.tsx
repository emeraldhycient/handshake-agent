import { AppShell } from "@/components/admin/app-shell"
import { NotificationsPage } from "@/components/admin/notifications-page"

/**
 * /notifications — the "Notifications & comms" surface (broadcast composer +
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function NotificationsRoute() {
  return (
    <AppShell>
      <NotificationsPage />
    </AppShell>
  )
}
