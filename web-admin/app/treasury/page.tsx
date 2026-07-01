import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { TreasuryPage } from "@/components/admin/treasury-page"

/**
 * /treasury — treasury oversight (design §6.13): custodial balances, fiat float, FX
 * position, the payout approval queue and child-address sweeps. Gated by RequireAuth
 * + wrapped in AppShell (no RequirePermission — this is a design reproduction that
 * must stay viewable). Composition only.
 */
export default function TreasuryRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <TreasuryPage />
      </AppShell>
    </RequireAuth>
  )
}
