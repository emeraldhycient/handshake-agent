/** Approvals page — the maker-checker dual-control inbox. */

// ─── Approvals page (design §6 Approvals, `screens/Approvals.html`) ──────────────

/** The two inbox buckets: changes awaiting my approval vs. changes I raised. */
export type AprTab = "awaiting" | "mine"

/**
 * One from→to field change inside a maker-checker request. The `from` is struck
 * through in danger-tone, the `to` shown in success-tone (design diff row).
 */
export interface ApprovalDiffRow {
  /** The changed field's label (e.g. "crypto.buy · USDT/NGN spread"). */
  field: string
  /** Previous value (rendered struck-through, danger tone). */
  from: string
  /** Proposed value (rendered success tone). */
  to: string
}

/** One itemized diff line inside a request card. */
export interface DiffLineProps {
  diff: ApprovalDiffRow
}

/** A single change-request card — kind pill, meta, reason, diff, disposition footer. */
export interface RequestCardProps {
  request: import("@handshake-agent/contracts").ChangeRequest
  /** My own request → dual control shows a guard, never live actions. */
  mine: boolean
  /** A disposition is in flight; both actions disable. */
  busy: boolean
  onApprove: () => void
  onReject: () => void
}

/** The bucket tab row (Awaiting me · My requests) with count badges. */
export interface ApprovalTabsProps {
  tab: AprTab
  awaitingCount: number
  myCount: number
  onSelect: (tab: AprTab) => void
}

/** The four-branch inbox region (loading / error / inbox-zero / request cards). */
export interface ApprovalInboxProps {
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  visible: readonly import("@handshake-agent/contracts").ChangeRequest[]
  tab: AprTab
  /** My admin id — an own-request row still shows the guard even off the "mine" tab. */
  myAdminId: string | undefined
  busy: boolean
  onApprove: (
    request: import("@handshake-agent/contracts").ChangeRequest
  ) => void
  onReject: (
    request: import("@handshake-agent/contracts").ChangeRequest
  ) => void
}
