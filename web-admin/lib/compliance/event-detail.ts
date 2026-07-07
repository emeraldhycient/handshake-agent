import type {
  ComplianceDispositionRequest,
  ComplianceEventDetail,
} from "@handshake-agent/contracts"

import type { BadgeVariant } from "@/types/components"

/** Absolute local timestamp, or an em-dash when the date is null. */
export function formatEventDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

/** Severity → the Badge variant (critical/high → destructive, else secondary). */
export function severityVariant(
  severity: ComplianceEventDetail["severity"]
): BadgeVariant {
  return severity === "critical" || severity === "high"
    ? "destructive"
    : "secondary"
}

/** Build the disposition input — a trimmed comment is included only when non-empty. */
export function buildDispositionInput(
  status: ComplianceDispositionRequest["status"],
  comment: string
): ComplianceDispositionRequest {
  return {
    status,
    ...(comment.trim() ? { comment: comment.trim() } : {}),
  }
}
