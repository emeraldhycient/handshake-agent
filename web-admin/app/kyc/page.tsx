import { RequireAuth } from "@/components/admin/require-auth"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppShell } from "@/components/admin/app-shell"
import { KycReviewPage } from "@/components/admin/kyc-review-page"

/**
 * /kyc — the KYC review queue. Gated by RequireAuth + the `/admin/kyc` web_page
 * permission. Composition only.
 */
export default function KycRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <RequirePermission page="/admin/kyc">
          <KycReviewPage />
        </RequirePermission>
      </AppShell>
    </RequireAuth>
  )
}
