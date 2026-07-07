import type { PersistedReconBreak, ReconRun } from "@handshake-agent/contracts"

/** Run type → its human label. */
export const RUN_TYPE_LABEL: Record<ReconRun["runType"], string> = {
  settlement_outbox: "Settlement outbox",
  wallet_deposit: "Wallet deposit",
}

/** Run status → the status-pill variant (running=warn, completed=success, failed=danger). */
export const RUN_STATUS_VARIANT: Record<
  ReconRun["status"],
  "success" | "warn" | "danger"
> = {
  running: "warn",
  completed: "success",
  failed: "danger",
}

/** Break status → the status-pill variant. */
export const BREAK_STATUS_VARIANT: Record<
  PersistedReconBreak["status"],
  "success" | "warn" | "info" | "neutral"
> = {
  detected: "warn",
  acknowledged: "info",
  resolved: "success",
  rejected: "neutral",
}

/** Break type → its human label. */
export const BREAK_TYPE_LABEL: Record<
  PersistedReconBreak["breakType"],
  string
> = {
  balance_mismatch: "Balance mismatch",
  over_credit: "Over-credit",
  settlement_failure: "Settlement failure",
}
