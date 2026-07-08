import { Panel } from "@/components/admin/user-detail/panel"
import type { UdKycReviewPanelProps } from "@/types/components"

/**
 * The KYC tab's right column — the review decision (Approve is a four-eyes
 * maker-checker action; Request info / Reject) and the tier controls (Override
 * tier · maker-checker, Force re-KYC). Every button only proposes — the decision
 * is step-up-gated and audited server-side (§3.1/§3.4).
 */
export function KycReviewPanel({
  approveTier,
  onApprove,
  onRequestInfo,
  onReject,
  onOverrideTier,
  onForceReKyc,
}: UdKycReviewPanelProps) {
  return (
    <Panel>
      <div className="mb-1 text-[13px] font-extrabold">Review decision</div>
      <div className="mb-3.5 text-xs text-ink2">
        Decisions are audited. Tier 2/3 require a second approver.
      </div>
      <div className="flex flex-col gap-[9px]">
        <button
          type="button"
          onClick={onApprove}
          className="flex cursor-pointer items-center justify-center gap-2 rounded-[11px] bg-[#1f8a5b] p-3 text-[13.5px] font-extrabold text-white focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="m5 12 5 5L20 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Approve · {approveTier} (maker-checker)
        </button>
        <div className="flex gap-[9px]">
          <button
            type="button"
            onClick={onRequestInfo}
            className="flex-1 cursor-pointer rounded-[11px] border border-line p-[11px] text-center text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Request info
          </button>
          <button
            type="button"
            onClick={onReject}
            className="flex-1 cursor-pointer rounded-[11px] border border-[#f0d0cb] p-[11px] text-center text-[12.5px] font-bold text-tdn transition-colors hover:bg-sdn focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Reject
          </button>
        </div>
      </div>
      <div className="my-4 h-px bg-line2" />
      <div className="mb-[9px] text-xs font-extrabold">Tier controls</div>
      <button
        type="button"
        onClick={onOverrideTier}
        className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded-[10px] border border-line p-[10px_12px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        Override tier · maker-checker
      </button>
      <button
        type="button"
        onClick={onForceReKyc}
        className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] border border-line p-[10px_12px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Force re-KYC
      </button>
    </Panel>
  )
}
