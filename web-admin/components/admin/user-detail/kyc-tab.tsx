import { KycIdentityPanel } from "@/components/admin/user-detail/kyc-identity-panel"
import { KycReviewPanel } from "@/components/admin/user-detail/kyc-review-panel"
import type { UdKycTabProps } from "@/types/components"

/**
 * The KYC tab — a two-column grid: the identity documents + liveness (left) and the
 * review-decision + tier controls (right). Identity PII is last-4 only (§3.4) and
 * every decision only proposes — Approve / Override tier are four-eyes maker-checker
 * actions the engine settles server-side (§3.1).
 */
export function KycTab({
  kyc,
  approveTier,
  onApprove,
  onRequestInfo,
  onReject,
  onOverrideTier,
  onForceReKyc,
}: UdKycTabProps) {
  return (
    <div className="grid grid-cols-[1.3fr_1fr] items-start gap-3.5">
      <KycIdentityPanel kyc={kyc} />
      <KycReviewPanel
        approveTier={approveTier}
        onApprove={onApprove}
        onRequestInfo={onRequestInfo}
        onReject={onReject}
        onOverrideTier={onOverrideTier}
        onForceReKyc={onForceReKyc}
      />
    </div>
  )
}
