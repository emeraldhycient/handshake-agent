import type { BlockedEntryKind } from "@handshake-agent/contracts"

/**
 * Derive the entry kind from the value's shape (the AddBlockedDialog collects only
 * the raw string). On-chain addresses (EVM / TRON) → "address"; a bare 10-digit
 * NUBAN → "bank"; everything else (a user id / handle) → "user".
 */
export function deriveKind(value: string): BlockedEntryKind {
  const v = value.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(v) || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) {
    return "address"
  }
  if (/^\d{10}(\s|·|$)/.test(v)) return "bank"
  return "user"
}

/** Render an ISO timestamp as a short, locale-stable "Jun 30" label. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}
