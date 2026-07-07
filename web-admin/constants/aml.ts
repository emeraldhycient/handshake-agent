/**
 * AML / risk constants (design §6.6). The example rule types, the open-status set, and
 * the case / report status → status-token maps. Colour is never the sole signal — every
 * pill carries its label.
 */
import type {
  ComplianceEventStatus,
  ComplianceReport,
} from "@handshake-agent/contracts"

/**
 * Example AML rule types operators can author. Rules are admin-authored — the list starts
 * empty by design; this documents the kinds of rule the compliance engine understands.
 */
export const AML_RULE_TYPE_EXAMPLES: readonly { key: string; desc: string }[] =
  [
    {
      key: "velocity_daily_limit",
      desc: "Cap the total value a user can transact in a rolling day.",
    },
    {
      key: "amount_threshold",
      desc: "Flag or hold any single transaction above an amount.",
    },
    {
      key: "kyc_tier_gate",
      desc: "Require a minimum KYC tier for a capability or amount band.",
    },
    {
      key: "geo_block",
      desc: "Deny transactions originating from restricted regions.",
    },
    {
      key: "sanctions_rescreen",
      desc: "Periodically re-screen a user against the sanctions lists.",
    },
  ]

/**
 * Status → { dot surface, pill label, pill surface + text }. Flagged reads danger,
 * under-review reads warning (design `stMeta`).
 */
export const CASE_STATUS_META: Record<
  ComplianceEventStatus,
  { dot: string; label: string; pillBg: string; pillFg: string }
> = {
  flagged: {
    dot: "bg-tdn",
    label: "Flagged",
    pillBg: "bg-sdn",
    pillFg: "text-tdn",
  },
  under_review: {
    dot: "bg-twn",
    label: "In review",
    pillBg: "bg-swn",
    pillFg: "text-twn",
  },
  approved: {
    dot: "bg-tok",
    label: "Approved",
    pillBg: "bg-sok",
    pillFg: "text-tok",
  },
  blocked: {
    dot: "bg-tif",
    label: "Blocked",
    pillBg: "bg-sif",
    pillFg: "text-tif",
  },
  dismissed: {
    dot: "bg-ink3",
    label: "Dismissed",
    pillBg: "bg-card2",
    pillFg: "text-ink2",
  },
}

/** The still-open statuses the "Open cases" queue surfaces (design intent). */
export const OPEN_STATUSES: readonly ComplianceEventStatus[] = [
  "flagged",
  "under_review",
]

/** Report status → { pill label, pill surface + text } (§5 status→token map). */
export const REPORT_STATUS_META: Record<
  ComplianceReport["status"],
  { label: string; pillBg: string; pillFg: string }
> = {
  draft: { label: "Draft", pillBg: "bg-swn", pillFg: "text-twn" },
  submitted: { label: "Submitted", pillBg: "bg-sif", pillFg: "text-tif" },
  rejected: { label: "Rejected", pillBg: "bg-sdn", pillFg: "text-tdn" },
  closed: { label: "Closed", pillBg: "bg-sok", pillFg: "text-tok" },
}
