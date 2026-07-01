import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { AssetsPage } from "@/components/admin/assets-page"

/**
 * /assets — the asset catalog (design §6.23). Composition only: RequireAuth +
 * AppShell. The screen is a pixel reproduction of the imported design (mock content,
 * no data wiring), so it is intentionally viewable without RequirePermission gating.
 */
export default function AssetsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <AssetsPage />
      </AppShell>
    </RequireAuth>
  )
}
