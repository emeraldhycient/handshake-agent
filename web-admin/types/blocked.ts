/** Blocked list page (§6.7). */

// ─── Blocked list page (§6.7) ──────────────────────────────────────────────────────

/** One deny-list row — active entries offer Unblock; superseded ones are audit history. */
export interface BlockedRowProps {
  entry: import("@handshake-agent/contracts").BlockedEntry
  onUnblock: () => void
}

/** The deny-list table card — loading / error / empty / data over `BlockedRow`. */
export interface BlockedTableProps {
  entries: import("@handshake-agent/contracts").BlockedEntry[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
  onUnblock: (entry: import("@handshake-agent/contracts").BlockedEntry) => void
}

/** The active supersede (unblock) flow: reason (audited) → the step-up-guarded POST. */
export interface SupersedeFlow {
  id: string
  value: string
}

/** A pending add awaiting its audited reason (the dialog already collected the value). */
export interface PendingAdd {
  value: string
}

/** An action awaiting a server step-up replay (so the post-re-auth toast reads right). */
export type PendingReplay =
  | { kind: "add"; value: string }
  | { kind: "supersede"; value: string }

export interface AddBlockedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The current denylist; the new value is appended and the whole array saved. */
  denylist: string[]
  /**
   * Persist the next denylist. Returns the mutation promise so the dialog can
   * await, surface its own error, and close on success. May trigger a step-up
   * challenge that the parent resolves.
   */
  onSave: (next: string[]) => Promise<void>
}
