/**
 * Bug 2 — map a REHYDRATED proposal's lifecycle status to a terminal card state.
 *
 * On reload (`GET /chat/messages`) a proposal outcome carries its CURRENT status.
 * An already-executed / rejected proposal must render a non-actionable terminal
 * card ("Completed" / "Cancelled") instead of a live "Review & confirm" quote
 * whose confirm would 409. Any other status (or none) → the live active/countdown
 * card, unchanged.
 */

import type { ProposalStatus } from "@handshake-agent/contracts"
import type { CardTerminalState } from "@/types/chat"

export type { CardTerminalState }

export function proposalTerminalState(
  status?: ProposalStatus
): CardTerminalState | null {
  switch (status) {
    case "executed":
      return {
        label: "Completed",
        hint: "This request has already been completed.",
        tone: "success",
      }
    case "rejected":
      return {
        label: "Cancelled",
        hint: "This request was cancelled.",
        tone: "neutral",
      }
    default:
      // pending / confirmed / executing / expired / failed / undefined → the
      // live countdown card handles these (expiry is driven by `expiresAt`).
      return null
  }
}
