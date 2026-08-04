/**
 * Users-directory constants (design `Users.html` / `logic.js`). Token utilities,
 * option sets, the shared grid template, and the avatar palette — no raw hex in
 * component files. Colour is never the sole signal; every pill carries a label.
 */
import type { AdminEndUserListItem } from "@handshake-agent/contracts"
import type { UserKycStatus, UserRiskFlag } from "@/types"

export const PAGE_SIZE = 10
export const MAX_WIDTH = "1360px"
export const SEARCH_DEBOUNCE_MS = 250

/** KYC bucket → pill tokens (design `kycMeta`). */
export const KYC_META: Record<
  UserKycStatus,
  { label: string; bg: string; fg: string }
> = {
  verified: { label: "Verified", bg: "bg-sok", fg: "text-tok" },
  pending: { label: "Pending", bg: "bg-swn", fg: "text-twn" },
  needs_info: { label: "Needs info", bg: "bg-sif", fg: "text-tif" },
  rejected: { label: "Rejected", bg: "bg-sdn", fg: "text-tdn" },
}

// Contract `KycStatus` → the design's four presentation buckets. `not_started`,
// `pending` and `pending_review` read as "Pending" (awaiting the applicant /
// reviewer); only the real `needs_info` bucket shows the "Needs info" pill;
// `expired` reads as a rejected-style pill.
export const KYC_STATUS_TO_BUCKET: Record<
  AdminEndUserListItem["kycStatus"],
  UserKycStatus
> = {
  not_started: "pending",
  pending: "pending",
  pending_review: "pending",
  needs_info: "needs_info",
  verified: "verified",
  rejected: "rejected",
  expired: "rejected",
}

// The design's KYC-status filter buckets → the contract `KycStatus` sent to the
// server-side `kycStatus` param. `not_started` / `expired` aren't selectable from
// the four-bucket UI.
export const KYC_BUCKET_TO_STATUS: Record<
  UserKycStatus,
  AdminEndUserListItem["kycStatus"]
> = {
  verified: "verified",
  pending: "pending",
  needs_info: "needs_info",
  rejected: "rejected",
}

/** Risk flag → badge label + tokens (design `flagMeta`). */
export const FLAG_META: Record<
  UserRiskFlag,
  { label: string; full: string; bg: string; fg: string }
> = {
  simSwap: {
    label: "SIM-SWAP",
    full: "SIM-swap risk detected",
    bg: "bg-sdn",
    fg: "text-tdn",
  },
  sanctions: {
    label: "SANCTIONS",
    full: "Sanctions screening hit",
    bg: "bg-sdn",
    fg: "text-tdn",
  },
}

// Filter-select option sets (design `uFilters`).
export const KYC_OPTIONS = [
  { value: "all", label: "All KYC" },
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Pending" },
  { value: "needs_info", label: "Needs info" },
  { value: "rejected", label: "Rejected" },
] as const

export const TIER_OPTIONS = [
  { value: "all", label: "All tiers" },
  { value: "unverified", label: "unverified" },
  { value: "tier_1", label: "tier_1" },
  { value: "tier_2", label: "tier_2" },
  { value: "tier_3", label: "tier_3" },
] as const

// Risk-toggle chips (design `riskDef`). Only the facets the list contract models
// are offered — the design's Country select and Velocity chip matched nothing
// (no such fields on `AdminEndUserListItem`) and were removed rather than left
// as dead controls that silently empty the table.
export const RISK_DEFS: ReadonlyArray<{ value: UserRiskFlag; label: string }> =
  [
    { value: "simSwap", label: "SIM-swap" },
    { value: "sanctions", label: "Sanctions" },
  ]

// The design's filter-select className: sits on `--card` (not `--field`), with the
// 12.5px/600 filter type and 11px radius from Users.html line 20.
export const FILTER_SELECT_CLASS =
  "h-[38px] w-auto min-w-0 rounded-[11px] border-line bg-card py-0 pr-[30px] pl-3 text-[12.5px] font-semibold"

// Shared 7-column grid (Users.html lines 44/52): checkbox · Customer · KYC ·
// Country · Balance · Risk · Last active. Used by the header row and every body row.
export const GRID_COLS =
  "grid grid-cols-[38px_2fr_1.1fr_0.9fr_1.2fr_1fr_1fr] items-center gap-3"

// Deterministic avatar hue palette (design `AVA`) — the list contract carries no
// avatar colour, so hue is derived from the id so a user keeps a stable colour.
export const AVATAR_HUES = [
  "#2a6f55",
  "#c07a2a",
  "#3a6ea5",
  "#8a4b8a",
  "#b0563f",
  "#4a8a6a",
  "#7a6aa0",
  "#a0834a",
] as const
