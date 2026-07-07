"use client"

/**
 * KycReviewPage — the "KYC review queue" screen (design §6.4). Composition only:
 * `useKycReviewQueue` owns the four bucket reads, the active tab + pagination, and the
 * deep-link navigation; the status tabs, queue table, and row live in
 * `components/admin/kyc-review/*`. Read-only — a row click opens the applicant's
 * user-detail KYC tab; no writes here (§5 four async branches).
 */
import { Pagination } from "@/components/admin/pagination"
import { KycStatusTabs } from "@/components/admin/kyc-review/kyc-status-tabs"
import { KycQueueTable } from "@/components/admin/kyc-review/kyc-queue-table"
import { useKycReviewQueue } from "@/lib/hooks/use-kyc-review-queue"
import { PAGE_SIZE } from "@/constants/kyc-review"

export function KycReviewPage() {
  const q = useKycReviewQueue()

  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="mb-[18px]">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          KYC review queue
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Applications awaiting a decision. Tier 2/3 approvals require a second
          approver.
        </p>
      </header>

      {/* ── Status tabs (counts) ─────────────────────────────────────────── */}
      <KycStatusTabs
        active={q.activeTab}
        counts={q.counts}
        onSelect={q.selectTab}
      />

      {/* ── Queue table ──────────────────────────────────────────────────── */}
      <KycQueueTable
        isLoading={q.query.isLoading}
        isError={q.query.isError}
        isEmpty={q.rows.length === 0}
        pageRows={q.pageRows}
        onOpen={q.openUserKyc}
        onRetry={() => void q.query.refetch()}
      />

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      <Pagination
        total={q.rows.length}
        pageSize={PAGE_SIZE}
        page={q.page}
        onPageChange={q.setPage}
        maxWidth="1200px"
      />
    </div>
  )
}
