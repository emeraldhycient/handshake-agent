import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { CurrenciesPage } from "@/components/admin/currencies-page"

/**
 * /currencies — the currency catalog (design §6.24). Composition only: the screen
 * is a pixel-for-pixel reproduction of the imported design, so it renders inside
 * RequireAuth + AppShell (auth still works) WITHOUT RequirePermission gating so the
 * design is viewable.
 */
export default function CurrenciesRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <CurrenciesPage />
      </AppShell>
    </RequireAuth>
  )
}
