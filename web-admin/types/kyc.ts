/** KYC review queue page. */

import type { KycSubmissionDetail } from "@handshake-agent/contracts"

// ─── KYC review page ─────────────────────────────────────────────────────────────

/**
 * One row in the KYC review queue (design `kycRows`, logic.js `vKyc()` line 645).
 * Design-reproduction screen: these are the design's own mock values, not live
 * queue data. `slaTone` maps the design's `slaFg` (near-black ink vs. `--tdn`
 * for the stalest bucket) onto a token utility class.
 */
export interface KycQueueRow {
  /** Applicant display name (design seed, e.g. "Amara Okeke"). */
  name: string
  /** Applicant user id — the row's navigation target (`/users/[id]`). */
  id: string
  /** Two-letter monogram for the avatar (design `ini()`). */
  initials: string
  /** Avatar background — a raw hue from the design's `AVA` palette. */
  avatar: string
  /** Requested KYC tier (`tier_1` | `tier_2` | `tier_3`). */
  tier: string
  /** SLA age label (design: "2h" / "6h" / "1d 4h"). */
  sla: string
  /** SLA-age urgency tone: normal ink, or danger for the stalest bucket. */
  slaTone: "ink" | "danger"
  /** Assignee name, or "Unassigned" (design alternates the two). */
  assignee: string
}

export interface KycQueueRowProps {
  /** The design-mock row this line renders. */
  row: KycQueueRow
  /** Navigate to the applicant's user-detail KYC tab (design `openUserKyc`). */
  onOpen: (userId: string) => void
}

/** The four review-queue buckets (each maps onto a real KYC-status filter). */
export type KycTabId = "pending" | "needs_info" | "approved" | "rejected"

/** The status pill-tabs — active bucket + each bucket's live count badge. */
export interface KycStatusTabsProps {
  active: KycTabId
  counts: Record<KycTabId, number | null>
  onSelect: (id: KycTabId) => void
}

/** The queue table card — header grid + the four async branches. */
export interface KycQueueTableProps {
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  pageRows: readonly KycQueueRow[]
  onOpen: (userId: string) => void
  onRetry: () => void
}

export interface KycSubmissionProps {
  /** The selected submission's userId, or null when the drawer is closed. */
  userId: string | null
  onOpenChange: (open: boolean) => void
}

export interface KycReviewActionsProps {
  submission: KycSubmissionDetail
}
