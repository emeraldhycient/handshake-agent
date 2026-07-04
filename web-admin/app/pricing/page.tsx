import { AppShell } from "@/components/admin/app-shell"
import { PricingPage } from "@/components/admin/pricing-page"

/**
 * /pricing — per capability × asset × currency pricing (design §6.22).
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function PricingRoute() {
  return (
    <AppShell>
      <PricingPage />
    </AppShell>
  )
}
