/**
 * Blocked-list constants (design §6.7 deny-list). The table grid template + the
 * per-kind chip label. No magic grid strings or label maps inline in components.
 */
import type { BlockedEntryKind } from "@handshake-agent/contracts"

// Design §6.7 table grid — Kind · Value · Reason · Added · Unblock.
export const BLOCKED_GRID = "grid-cols-[0.7fr_1.6fr_1.8fr_1.2fr_0.7fr]"

/** The human label for a deny-list kind chip. */
export const KIND_LABEL: Record<BlockedEntryKind, string> = {
  user: "User",
  address: "Address",
  bank: "Bank",
}
