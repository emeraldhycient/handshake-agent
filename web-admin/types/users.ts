/** Users directory page — rows, filters, bulk actions. */

import type { AdminEndUserListItem, KycTier } from "@handshake-agent/contracts"

// ─── Users page ──────────────────────────────────────────────────────────────────

/** The risk facets the users filter row exposes as toggle chips (modeled fields only). */
export type UserRiskFlag = "simSwap" | "sanctions"

/** A user's KYC bucket → the design's `kycMeta` pill mapping (logic.js line 496). */
export type UserKycStatus = "verified" | "pending" | "needs_info" | "rejected"

/**
 * A presentation row derived from an `AdminEndUserListItem` (via `toRow`). The
 * live shape the Users table renders — avatar hue + initials are derived (no
 * colour field in the list contract); `balance` / `lastActive` are pre-formatted.
 */
export interface UsersRow {
  id: string
  name: string
  email: string
  /** 2-letter avatar initials (`lib/avatar` `initialsOf`). */
  initials: string
  /** Avatar background hex, derived deterministically from the id. */
  avatar: string
  kyc: UserKycStatus
  tier: KycTier
  simSwapFlagged: boolean
  sanctionsFlagged: boolean
  /** Pre-formatted per-asset balance summary (or em dash). */
  balance: string
  /** Relative "last active" label (or em dash when never active). */
  lastActive: string
}

/** One Users-directory row — selectable checkbox + opens the detail route. */
export interface UserRowProps {
  user: UsersRow
  selected: boolean
  onToggleSelect: (id: string) => void
  onOpen: (id: string) => void
}

/** Users-directory header — count/total + the CSV export affordance. */
export interface UsersHeaderProps {
  shown: number
  total?: number
  /** Shown when there is no server `total` but a next page exists. */
  moreAvailable: boolean
  exporting: boolean
  onExport: () => void
}

/** The Users-directory filter row: search + KYC/tier selects + risk chips. */
export interface UsersFilterBarProps {
  search: string
  onSearchChange: (value: string) => void
  kyc: string
  onKycChange: (value: string) => void
  tier: string
  onTierChange: (value: string) => void
  risk: UserRiskFlag | ""
  onToggleRisk: (value: UserRiskFlag) => void
}

/** The contextual bulk-actions bar shown when rows are selected. */
export interface UsersBulkBarProps {
  count: number
  exporting: boolean
  onExport: () => void
  selectedIds: readonly string[]
  /** Clears the selection after a successful tag/message op. */
  onActionDone: () => void
  onClear: () => void
}

/** The 7-column directory table with its own loading / error / empty / data branches. */
export interface UsersTableProps {
  rows: UsersRow[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  allSelected: boolean
  selectedIds: readonly string[]
  onToggleSelectAll: () => void
  onToggleSelect: (id: string) => void
  onRetry: () => void
  onOpen: (id: string) => void
}

export interface UserStatusBadgeProps {
  /** An end-user account status (distinct from the admin-console statuses). */
  status: AdminEndUserListItem["status"]
}

export interface KycStatusBadgeProps {
  status: AdminEndUserListItem["kycStatus"]
}

export interface UserDetailProps {
  /** The route's user id (`/users/[id]`). */
  userId: string
}

/**
 * The Users-directory bulk-bar actions (tag + message) over the current selection.
 * `selectedIds` is the explicit set the two operations target; `onDone` is called
 * after a successful op so the page can clear the selection.
 */
export interface UsersBulkActionsProps {
  selectedIds: readonly string[]
  onDone: () => void
}

/** The bulk TAG dialog's form state + submit (from `useUsersBulkActions`). */
export interface BulkTagState {
  open: boolean
  setOpen: (open: boolean) => void
  value: string
  setValue: (value: string) => void
  reason: string
  setReason: (value: string) => void
  submit: () => void
  applying: boolean
}

/** The bulk MESSAGE dialog's form state + submit (from `useUsersBulkActions`). */
export interface BulkMessageState {
  open: boolean
  setOpen: (open: boolean) => void
  eventType: import("@handshake-agent/contracts").BulkMessageEventType
  setEventType: (
    value: import("@handshake-agent/contracts").BulkMessageEventType
  ) => void
  templateKey: string
  setTemplateKey: (value: string) => void
  reason: string
  setReason: (value: string) => void
  confirmLargeSet: boolean
  setConfirmLargeSet: (value: boolean) => void
  submit: () => void
  queueing: boolean
}

/** The bulk TAG dialog — an operator tag annotation over the selection (step-up-gated). */
export interface BulkTagDialogProps {
  tag: BulkTagState
  ids: readonly string[]
  error: string | null
  busy: boolean
}

/** The bulk MESSAGE dialog — a templated broadcast queued over the selection. */
export interface BulkMessageDialogProps {
  message: BulkMessageState
  ids: readonly string[]
  error: string | null
  busy: boolean
}
