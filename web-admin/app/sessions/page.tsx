import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { SessionsPage } from "@/components/admin/sessions-page"

/**
 * /sessions — admin session management. Gated by RequireAuth + the
 * `/admin/sessions` web_page permission. Composition only.
 */
export default function SessionsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/sessions">
          <SessionsPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
