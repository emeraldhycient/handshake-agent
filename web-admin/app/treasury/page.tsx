import { AppShell } from "@/components/admin/app-shell"
import { TreasuryPage } from "@/components/admin/treasury-page"

/**
 * /treasury — treasury oversight (design §6.13): custodial balances, fiat float, FX
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function TreasuryRoute() {
  return (
    <AppShell>
      <TreasuryPage />
    </AppShell>
  )
}
