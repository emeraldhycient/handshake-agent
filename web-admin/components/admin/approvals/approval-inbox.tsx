import { Skeleton } from "@/components/ui/skeleton"
import type { ApprovalInboxProps } from "@/types"

import { InboxZero } from "./inbox-zero"
import { RequestCard } from "./request-card"

/**
 * The inbox body's four async branches (loading / error / inbox-zero / request cards).
 * An own-request card is guarded even off the "mine" tab (`request... === myAdminId`),
 * mirroring the server-authoritative dual-control rule.
 */
export function ApprovalInbox({
  isLoading,
  isError,
  onRetry,
  visible,
  tab,
  myAdminId,
  busy,
  onApprove,
  onReject,
}: ApprovalInboxProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-[168px] rounded-2xl" />
        <Skeleton className="h-[168px] rounded-2xl" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-sdn bg-sdn/40 px-5 py-8 text-center">
        <p className="text-[12.5px] font-semibold text-tdn">
          Failed to load the approvals inbox
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-[9px] bg-btn-dark px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }

  if (visible.length === 0) return <InboxZero />

  return (
    <div className="flex flex-col gap-3">
      {visible.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          mine={tab === "mine" || request.requestedByAdminId === myAdminId}
          busy={busy}
          onApprove={() => onApprove(request)}
          onReject={() => onReject(request)}
        />
      ))}
    </div>
  )
}
