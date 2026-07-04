import { AppShell } from "@/components/admin/app-shell"
import { MyAccountPage } from "@/components/admin/my-account-page"

/**
 * /account — the signed-in operator's self-service profile (edit own display
 * name). Composition only — AppShell centrally enforces auth; this route needs
 * no elevated permission (self-edit is always allowed).
 */
export default function AccountRoute() {
  return (
    <AppShell>
      <MyAccountPage />
    </AppShell>
  )
}
