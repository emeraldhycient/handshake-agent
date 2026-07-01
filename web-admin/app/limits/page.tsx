import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { LimitsPage } from "@/components/admin/limits-page"

/**
 * /limits — "Limits & velocity" (design §6.26): per-tier amount caps + velocity/
 * counts. Design reproduction — the screen renders the design's own mock content
 * (not real config data); real-data reintegration is a separate, later step.
 * Composition only: RequireAuth + AppShell (auth still works), no permission gate
 * so the design reproduction stays viewable.
 */
export default function LimitsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <LimitsPage />
      </AppShell>
    </RequireAuth>
  )
}
