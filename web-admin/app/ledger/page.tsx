import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { LedgerPage } from "@/components/admin/ledger-page"

/**
 * /ledger — double-entry ledger oversight + integrity verify. Gated by RequireAuth
 * + the `/admin/ledger` web_page permission. Composition only.
 */
export default function LedgerRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/ledger">
          <LedgerPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
