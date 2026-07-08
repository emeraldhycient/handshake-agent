import type { PersistedReconBreak } from "@handshake-agent/contracts"

/** A break is still actionable while it has not reached a terminal disposition. */
export function isActionable(status: PersistedReconBreak["status"]): boolean {
  return status === "detected" || status === "acknowledged"
}

/** Absolute local timestamp, falling back to the raw string when unparseable. */
export function formatRunDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}
