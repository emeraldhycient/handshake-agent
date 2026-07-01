import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { LedgerPage } from "@/components/admin/ledger-page"

/**
 * /ledger — the double-entry ledger viewer (design §6.11). Composition only:
 * RequireAuth + AppShell wrap the design-reproduction page. No RequirePermission
 * gate — this is a design reproduction that must stay viewable.
 */
export default function LedgerRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <LedgerPage />
      </AppShell>
    </RequireAuth>
  )
}
