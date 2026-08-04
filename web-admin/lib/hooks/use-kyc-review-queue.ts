"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { useKycQueue } from "@/lib/query/hooks"
import { toQueueRow } from "@/lib/kyc-review/rows"
import { PAGE_SIZE } from "@/constants/kyc-review"
import type { KycQueueRow, KycTabId } from "@/types"

/**
 * The KYC review-queue data layer. Each design tab maps onto a real KYC-status bucket,
 * so all four buckets are queried (fixed order — safe for the Rules of Hooks) to give
 * every tab live rows + a real count badge. The active bucket paginates at PAGE_SIZE.
 * Read-only — a row click deep-links to the applicant's user-detail KYC tab; no writes.
 */
export function useKycReviewQueue() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<KycTabId>("pending")
  const [page, setPage] = useState(1)

  const pendingQuery = useKycQueue("pending_review")
  const needsInfoQuery = useKycQueue("needs_info")
  const approvedQuery = useKycQueue("verified")
  const rejectedQuery = useKycQueue("rejected")

  const queries: Record<KycTabId, ReturnType<typeof useKycQueue>> = {
    pending: pendingQuery,
    needs_info: needsInfoQuery,
    approved: approvedQuery,
    rejected: rejectedQuery,
  }
  const query = queries[activeTab]

  const rows = useMemo<KycQueueRow[]>(
    () => query.data?.items.map(toQueueRow) ?? [],
    [query.data]
  )

  const pageRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  )

  // A tab's badge shows its bucket's real count once the query resolves; null
  // (rendered "—") while it is still loading or errored.
  const counts: Record<KycTabId, number | null> = {
    pending: pendingQuery.isSuccess ? pendingQuery.data.items.length : null,
    needs_info: needsInfoQuery.isSuccess
      ? needsInfoQuery.data.items.length
      : null,
    approved: approvedQuery.isSuccess ? approvedQuery.data.items.length : null,
    rejected: rejectedQuery.isSuccess ? rejectedQuery.data.items.length : null,
  }

  const selectTab = (id: KycTabId) => {
    setActiveTab(id)
    setPage(1)
  }

  // Design `openUserKyc`: open the applicant's user-detail KYC tab.
  const openUserKyc = (userId: string) =>
    router.push(`/users/${userId}?tab=kyc`)

  return {
    activeTab,
    selectTab,
    query,
    rows,
    pageRows,
    counts,
    page,
    setPage,
    openUserKyc,
  }
}
