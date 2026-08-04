/** Audit log page (§6.10). */

// ─── Audit log page (§6.10) ───────────────────────────────────────────────────────

/** One rendered audit row. */
export interface AuditRowProps {
  entry: import("@handshake-agent/contracts").AuditLogEntry
}

/**
 * What `ChainPill` reads from the on-mount verify mutation — a structural subset so
 * `types/` need not import the query hook's return type (layering-safe).
 */
export interface AuditChainVerifyState {
  isPending: boolean
  isIdle: boolean
  isError: boolean
  data?: { ok: boolean; brokenAt?: string | null }
}

/** The header hash-chain integrity pill. */
export interface ChainPillProps {
  verify: AuditChainVerifyState
}

/** The audit-log filter row (search + action + from/to date range). */
export interface AuditFilterBarProps {
  search: string
  onSearchChange: (value: string) => void
  action: string
  onActionChange: (value: string) => void
  from: string
  onFromChange: (value: string) => void
  to: string
  onToChange: (value: string) => void
}

/** The audit-log table — header + loading / error / empty / data. */
export interface AuditTableProps {
  items: import("@handshake-agent/contracts").AuditLogEntry[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
}
