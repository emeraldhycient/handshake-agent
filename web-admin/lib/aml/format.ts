import type { AmlRule, ComplianceEventItem } from "@handshake-agent/contracts"

/**
 * Compose the mono/tnum threshold string the design shows from the rule's typed
 * `parameters` record. Renders `key value` pairs; an em dash when empty.
 */
export function thresholdFromParameters(
  parameters: AmlRule["parameters"]
): string {
  const entries = Object.entries(parameters)
  if (entries.length === 0) return "—"
  return entries
    .map(([key, value]) => `${key.replace(/_/g, " ")} ${String(value)}`)
    .join(" · ")
}

/** Compose the human title the design shows (`eventType` humanised + rule/hit). */
export function caseTitle(event: ComplianceEventItem): string {
  const type = event.eventType.replace(/[._]/g, " ")
  return event.ruleOrHit ? `${type} — ${event.ruleOrHit}` : type
}

/** Compose the meta line (severity · user · txn? · captured-at) from the DTO fields. */
export function caseMeta(event: ComplianceEventItem): string {
  const parts = [
    `${event.severity} severity`,
    `user ${event.userId.slice(0, 8)}`,
  ]
  if (event.transactionId) parts.push(`txn ${event.transactionId.slice(0, 8)}`)
  parts.push(new Date(event.createdAt).toLocaleDateString())
  return parts.join(" · ")
}
