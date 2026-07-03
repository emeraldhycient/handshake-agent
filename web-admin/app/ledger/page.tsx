import { AppShell } from "@/components/admin/app-shell"
import { LedgerPage } from "@/components/admin/ledger-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function LedgerRoute() {
  return (
    <AppShell>
      <LedgerPage />
    </AppShell>
  )
}
