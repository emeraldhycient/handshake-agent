import { AppShell } from "@/components/admin/app-shell"
import { KycReviewPage } from "@/components/admin/kyc-review-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function KycRoute() {
  return (
    <AppShell>
      <KycReviewPage />
    </AppShell>
  )
}
