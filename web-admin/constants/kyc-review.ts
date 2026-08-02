import type { KycStatus, KycTier } from "@handshake-agent/contracts"

import type { KycTabId } from "@/types"

/**
 * Avatar hue palette (design `AVA`, logic.js line 3). Presentation-only: a stable hue
 * is derived per applicant so the avatar column matches the design — styling, not
 * fabricated queue data. Raw hex verbatim from the design markup.
 */
export const AVA = [
  "#2a6f55",
  "#c07a2a",
  "#3a6ea5",
  "#8a4b8a",
  "#b0563f",
  "#4a8a6a",
  "#7a6aa0",
  "#a0834a",
] as const

/**
 * Status tabs (design `kycTabs`, logic.js line 647). Each design tab maps onto a real
 * KYC-status bucket, queried independently so the rows and the count badge are live.
 */
export const TABS: readonly {
  id: KycTabId
  label: string
  status: KycStatus
}[] = [
  { id: "pending", label: "Pending", status: "pending_review" },
  { id: "needs_info", label: "Needs info", status: "needs_info" },
  { id: "approved", label: "Approved", status: "verified" },
  { id: "rejected", label: "Rejected", status: "rejected" },
]

/** The tier chip label the design shows (design `tierLabel`). */
export const TIER_LABELS: Record<KycTier, string> = {
  unverified: "Unverified",
  tier_1: "Tier 1",
  tier_2: "Tier 2",
  tier_3: "Tier 3",
}

/** The stalest bucket (design `slaFg` → `--tdn`): past this age the SLA cell is danger-tinted. */
export const SLA_DANGER_SECONDS = 24 * 60 * 60 // 1 day

/**
 * Design grid: Applicant 2fr · Requested tier 1fr · SLA age 1fr · Assignee 1fr ·
 * Review→ 0.8fr, gap 12px (Kyc.html header + row).
 */
export const KYC_GRID = "grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr] gap-3"

/** The design paginates each bucket at 8 rows (`mkPager('kyc', …, 8, '1200px')`). */
export const PAGE_SIZE = 8

/** A subtle placeholder for a design column the contract does not populate. */
export const MISSING = "—"
