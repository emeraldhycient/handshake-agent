/**
 * Compliance-console constants (Phase 3). The tab set + the status → Badge variant maps
 * (§5 status→token map). Colour follows severity but is never the sole signal — the
 * status word is the label.
 */
import type {
  ComplianceReport,
  ComplianceSeverity,
  SanctionsRecordItem,
} from "@handshake-agent/contracts"
import type { BadgeVariant, ComplianceTab } from "@/types/components"

export const TABS: readonly ComplianceTab[] = [
  "Events",
  "AML Rules",
  "Travel Rule",
  "Reports",
  "Sanctions",
]

export const SEVERITY_VARIANT: Record<ComplianceSeverity, BadgeVariant> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "neutral",
}

export const VERDICT_VARIANT: Record<
  SanctionsRecordItem["verdict"],
  BadgeVariant
> = {
  hit: "danger",
  inconclusive: "warn",
  clear: "success",
}

export const REPORT_VARIANT: Record<ComplianceReport["status"], BadgeVariant> =
  {
    submitted: "success",
    closed: "success",
    rejected: "danger",
    draft: "neutral",
  }
