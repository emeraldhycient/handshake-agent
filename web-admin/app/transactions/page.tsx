import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { TransactionsPage } from "@/components/admin/transactions-page"

/**
 * /transactions — engine transaction oversight + triage. Gated by RequireAuth +
 * the `/admin/transactions` web_page permission. Composition only.
 */
export default function TransactionsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/transactions">
          <TransactionsPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
