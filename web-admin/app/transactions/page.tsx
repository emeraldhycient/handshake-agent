import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { TransactionsPage } from "@/components/admin/transactions-page"

/**
 * /transactions — master-ledger transaction oversight (design §6.8 `pTxns`). Gated by
 * RequireAuth + wrapped in AppShell; no RequirePermission gate so the design
 * reproduction stays viewable. Composition only.
 */
export default function TransactionsRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <TransactionsPage />
      </AppShell>
    </RequireAuth>
  )
}
