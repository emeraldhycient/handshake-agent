import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { TreasuryPage } from "@/components/admin/treasury-page"

/**
 * /treasury — treasury oversight (balances / exposure / alerts / withdrawal
 * policies). Gated by RequireAuth + the `/admin/treasury` web_page permission.
 * Composition only.
 */
export default function TreasuryRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/treasury">
          <TreasuryPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
