import { AppShell } from "@/components/admin/app-shell"
import { CurrenciesPage } from "@/components/admin/currencies-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function CurrenciesRoute() {
  return (
    <AppShell>
      <CurrenciesPage />
    </AppShell>
  )
}
