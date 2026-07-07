"use client"

/**
 * ApprovalsPage — the maker-checker approval inbox (design §6 Approvals). Composition
 * only: the dual-control disposition state machine lives in `useApprovalsPage`, the
 * inbox branches + cards in `components/admin/approvals/*`.
 *
 * Funds-safety (root §3.1): this screen never moves money. A disposition routes through
 * the deterministic engine / config writer server-side — Approve hands the recorded
 * change to the target service to APPLY, Reject applies nothing — and both are sensitive
 * (step-up-gated, audited, idempotent). The UI enforces the chain:
 *   • Approve → StepUpDialog (re-auth) → POST /admin/approvals/:id/approve
 *   • Reject  → ReasonModal (required, audited reason) → POST .../reject
 * Both may 403 with ADMIN_STEP_UP_REQUIRED; `useStepUpRetry` re-auths and replays.
 * On success the inbox is invalidated so the buckets + badges re-resolve.
 */
import { ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { ApprovalInbox } from "@/components/admin/approvals/approval-inbox"
import { ApprovalTabs } from "@/components/admin/approvals/approval-tabs"
import { useApprovalsPage } from "@/lib/hooks/use-approvals-page"

export function ApprovalsPage() {
  const s = useApprovalsPage()

  return (
    <div className="mx-auto w-full max-w-[940px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Approvals
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Dual-control queue. High-risk changes require a second admin before
          they take effect.
        </p>
      </div>

      {s.actionError && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-sdn bg-sdn/40 px-4 py-3 text-[12.5px] font-semibold text-tdn"
        >
          {s.actionError}
        </p>
      )}

      {/* ── Tabs: Awaiting me · My requests (counts from the inbox read) ── */}
      <ApprovalTabs
        tab={s.tab}
        awaitingCount={s.awaitingCount}
        myCount={s.myCount}
        onSelect={s.setTab}
      />

      {/* ── Loading / error / empty / data ── */}
      <ApprovalInbox
        isLoading={s.inbox.isLoading}
        isError={s.inbox.isError}
        onRetry={() => void s.inbox.refetch()}
        visible={s.visible}
        tab={s.tab}
        myAdminId={s.myAdminId}
        busy={s.busy}
        onApprove={s.onApprove}
        onReject={s.setRejecting}
      />

      {/* ── Reject flow: reason (audit) → POST .../reject ── */}
      <ReasonModal
        open={s.rejecting !== null}
        onOpenChange={(open) => {
          if (!open) s.setRejecting(null)
        }}
        title={s.rejectTitle}
        onContinue={s.confirmReject}
      />

      {/* ── Step-up re-auth → replays the stashed approve/reject mutation ── */}
      <StepUpDialog
        open={s.stepUp.open}
        mfaEnabled={s.me.data?.mfaEnabled ?? false}
        onOpenChange={s.stepUp.setOpen}
        onSuccess={s.onStepUpSuccess}
      />
    </div>
  )
}
