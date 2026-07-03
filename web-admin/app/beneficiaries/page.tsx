import { AppShell } from "@/components/admin/app-shell"
import { BeneficiariesPage } from "@/components/admin/beneficiaries-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function BeneficiariesRoute() {
  return (
    <AppShell>
      <BeneficiariesPage />
    </AppShell>
  )
}
