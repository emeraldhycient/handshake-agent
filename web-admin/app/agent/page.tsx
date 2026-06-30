import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { AgentPage } from "@/components/admin/agent-page"

/**
 * /agent — the read-only agent config + conversation-log surface. Gated by
 * RequireAuth + the `/admin/agent` web_page permission. Composition only.
 */
export default function AgentRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/agent">
          <AgentPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
