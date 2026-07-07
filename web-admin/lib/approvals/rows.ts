import type { ChangeRequest } from "@handshake-agent/contracts"

import { KIND_META } from "@/constants/approvals"
import type { ApprovalDiffRow } from "@/types/components"

/** Compact relative-time label ("34m ago" / "2h ago" / "3d ago") from an ISO date. */
export function relativeAgo(iso: string, now: number = Date.now()): string {
  const deltaMs = Math.max(0, now - new Date(iso).getTime())
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Derive the design's from→to diff rows from a change request's opaque payload.
 * A `{ from, to }` pair renders as a struck-old → new row; any other value renders
 * as a "set to" row. This is display-only — the server re-validates the payload on
 * approval (§3.1); nothing here is trusted as a financial instruction.
 */
export function diffRows(cr: ChangeRequest): ApprovalDiffRow[] {
  const entries = Object.entries(cr.payload)
  if (entries.length === 0) {
    return [{ field: cr.resource, from: "current", to: "requested change" }]
  }
  return entries.map(([field, value]) => {
    if (
      value !== null &&
      typeof value === "object" &&
      "from" in value &&
      "to" in value
    ) {
      const pair = value as { from: unknown; to: unknown }
      return { field, from: String(pair.from), to: String(pair.to) }
    }
    return { field, from: "—", to: String(value) }
  })
}

/** A short title for the request row (kind label + target resource). */
export function requestTitle(cr: ChangeRequest): string {
  return `${KIND_META[cr.kind].label} · ${cr.resource}`
}
