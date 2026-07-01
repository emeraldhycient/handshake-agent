import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { BlockedPage } from "@/components/admin/blocked-page"

/**
 * /blocked — the blocked-list surface (design §6.7). Gated by RequireAuth +
 * AppShell only: this route is a pixel-faithful design reproduction, so it is
 * viewable without RequirePermission gating (real-data + RBAC reintegration is a
 * separate later step). Composition only — the screen lives in `BlockedPage`.
 */
export default function BlockedRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <BlockedPage />
      </AppShell>
    </RequireAuth>
  )
}
