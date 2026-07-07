import type { KycQueueItem } from "@handshake-agent/contracts"

import { AVA, SLA_DANGER_SECONDS, TIER_LABELS } from "@/constants/kyc-review"
import type { KycQueueRow } from "@/types/components"

/** Stable non-negative hash of a string → used to pick a deterministic avatar hue. */
export function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/** Two-letter monogram from an applicant's email local-part (no name is surfaced). */
export function initialsFromEmail(email: string | null): string {
  if (!email) return "?"
  const local = email.split("@")[0] ?? ""
  const parts = local.split(/[._-]+/).filter(Boolean)
  const letters =
    parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`
      : local.slice(0, 2) || "?"
  return letters.toUpperCase()
}

/**
 * Format an SLA age (whole seconds) into the design's compact "2h" / "45m" /
 * "1d 4h" label. Presentation-only.
 */
export function formatSla(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
}

/**
 * Map one enriched backend queue item onto the design's row shape. The applicant name
 * falls back to email then user id; assignee is still not modeled (rendered "—").
 */
export function toQueueRow(item: KycQueueItem): KycQueueRow {
  return {
    name: item.displayName ?? item.email ?? item.userId,
    id: item.userId,
    initials: initialsFromEmail(item.email),
    avatar: AVA[hashString(item.userId) % AVA.length],
    tier: item.requestedTier ? TIER_LABELS[item.requestedTier] : "",
    sla: formatSla(item.slaAgeSeconds),
    slaTone: item.slaAgeSeconds >= SLA_DANGER_SECONDS ? "danger" : "ink",
    // Not provided by KycQueueItem — rendered as "—" (shape gap).
    assignee: "",
  }
}
