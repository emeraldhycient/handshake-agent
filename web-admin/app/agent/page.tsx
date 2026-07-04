import { AppShell } from "@/components/admin/app-shell"
import { AgentPage } from "@/components/admin/agent-page"

/**
 * /agent — the agent config surface (design §6.17), reproduced pixel-for-pixel from
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function AgentRoute() {
  return (
    <AppShell>
      <AgentPage />
    </AppShell>
  )
}
