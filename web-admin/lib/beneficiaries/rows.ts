import type { AdminBeneficiary } from "@handshake-agent/contracts"

import type { BadgeVariant } from "@/types"

/** Absolute local timestamp, or an em-dash when the date is null. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

/** Human label for the beneficiary type (bank vs. on-chain address). */
export function typeLabel(type: AdminBeneficiary["type"]): string {
  return type === "bank_account" ? "Bank account" : "USDT address"
}

/**
 * Name-enquiry / verification status → status-pill variant. `verified` reads as a name
 * match (success); a failed/rejected enquiry is danger; pending/unverified is a warning.
 */
export function verificationVariant(status: string): BadgeVariant {
  const s = status.toLowerCase()
  if (s === "verified") return "success"
  if (s === "failed" || s === "rejected") return "danger"
  if (s === "pending" || s === "unverified") return "warn"
  return "neutral"
}
