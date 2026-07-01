import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { PricingPage } from "@/components/admin/pricing-page"

/**
 * /pricing — per capability × asset × currency pricing (design §6.22).
 *
 * DESIGN REPRODUCTION: wrapped in RequireAuth + AppShell (auth still works); no
 * RequirePermission gating so the design reproduction is always viewable.
 * Composition only.
 */
export default function PricingRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <PricingPage />
      </AppShell>
    </RequireAuth>
  )
}
