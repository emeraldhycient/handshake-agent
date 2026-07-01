import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { BeneficiariesPage } from "@/components/admin/beneficiaries-page"

/**
 * /beneficiaries — beneficiary oversight + cooling-off override. Gated by
 * RequireAuth + the `/admin/beneficiaries` web_page permission. Composition only.
 */
export default function BeneficiariesRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/beneficiaries">
          <BeneficiariesPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
