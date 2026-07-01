import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { AgentPage } from "@/components/admin/agent-page"

/**
 * /agent — the agent config surface (design §6.17), reproduced pixel-for-pixel from
 * the operator-console design. Gated by RequireAuth + wrapped in AppShell (auth still
 * works); no page-permission gating so the design reproduction stays viewable.
 * Composition only.
 */
export default function AgentRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <AgentPage />
      </AppShell>
    </RequireAuth>
  )
}
