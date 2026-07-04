import { AppShell } from "@/components/admin/app-shell"
import { TransactionDetail } from "@/components/admin/transaction-detail"

/**
 * /transactions/[id] — transaction detail (design §6.9: itemized parameters,
 * double-entry ledger, engine-state timeline, provider references, webhook
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default async function TransactionDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <AppShell>
      <TransactionDetail transactionId={id} />
    </AppShell>
  )
}
