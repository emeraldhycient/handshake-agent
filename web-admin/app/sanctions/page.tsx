import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { SanctionsPage } from "@/components/admin/sanctions-page"

/**
 * /sanctions — sanctions & screening review (design §6.5). Gated by RequireAuth +
 * AppShell only: this route is a pixel-faithful design reproduction, so it is
 * viewable without RequirePermission gating (real-data + RBAC reintegration is a
 * separate later step). Composition only — the screen lives in `SanctionsPage`.
 */
export default function SanctionsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <SanctionsPage />
      </AppShell>
    </RequireAuth>
  )
}
