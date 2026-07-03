import { AppShell } from "@/components/admin/app-shell"
import { ApprovalsPage } from "@/components/admin/approvals-page"

/**
 * /approvals — the maker-checker approval inbox (design §6 Approvals — surfaces
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function ApprovalsRoute() {
  return (
    <AppShell>
      <ApprovalsPage />
    </AppShell>
  )
}
