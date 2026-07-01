import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { KycReviewPage } from "@/components/admin/kyc-review-page"

/**
 * /kyc — the "KYC review queue" screen (design reproduction). Gated by RequireAuth +
 * wrapped in AppShell; no RequirePermission gating so the design reproduction is
 * viewable. Composition only.
 */
export default function KycRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <KycReviewPage />
      </AppShell>
    </RequireAuth>
  )
}
