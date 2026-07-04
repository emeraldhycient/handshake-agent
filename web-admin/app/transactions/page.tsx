import { AppShell } from "@/components/admin/app-shell"
import { TransactionsPage } from "@/components/admin/transactions-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function TransactionsRoute() {
  return (
    <AppShell>
      <TransactionsPage />
    </AppShell>
  )
}
