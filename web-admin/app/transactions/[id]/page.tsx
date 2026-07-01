import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { TransactionDetail } from "@/components/admin/transaction-detail"

/**
 * /transactions/[id] — transaction detail (design §6.9: itemized parameters,
 * double-entry ledger, engine-state timeline, provider references, webhook
 * history + engine-brokered triage actions). Gated by RequireAuth + AppShell so
 * auth still works; no RequirePermission gating — this is a design-reproduction
 * screen that must be viewable. Composition only — resolves the route id and
 * hands it to the screen component.
 *
 * Next 16: route `params` is a Promise (async request API) — await it.
 */
export default async function TransactionDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <RequireAuth>
      <AppShell>
        <TransactionDetail transactionId={id} />
      </AppShell>
    </RequireAuth>
  )
}
