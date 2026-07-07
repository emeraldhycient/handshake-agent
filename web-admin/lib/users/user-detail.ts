import type {
  AdminEndUserDetail,
  KycApproveRequest,
  KycSubmissionDetail,
} from "@handshake-agent/contracts"

import type { PillMeta } from "@/types/components"

/** Display name from KYC identity, falling back to the email local-part, then id. */
export function displayName(
  kyc: KycSubmissionDetail | undefined,
  detail: AdminEndUserDetail
): string {
  const full = [kyc?.firstName, kyc?.lastName].filter(Boolean).join(" ").trim()
  if (full) return full
  if (detail.email) return detail.email.split("@")[0]
  return detail.id
}

/** Two-letter avatar initials from the display name (design shows a monogram). */
export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
  return letters.toUpperCase() || "?"
}

/**
 * The tier a KYC approval promotes to. Approval never lands on 'unverified'
 * (mirrors KycApproveRequest, which only accepts tier_1/2/3): we take the
 * submission's requested tier when it is a verified tier, else default to tier_1.
 */
export function approveTargetTier(
  kyc: KycSubmissionDetail | undefined
): KycApproveRequest["tier"] {
  const requested = kyc?.tier
  return requested && requested !== "unverified" ? requested : "tier_1"
}

/** Beneficiary verification status → the design's name-enquiry pill tokens. */
export function beneVerificationMeta(status: string): PillMeta {
  const s = status.toLowerCase()
  if (s.includes("verif") || s.includes("match"))
    return { label: "Name match", bg: "var(--sok)", fg: "var(--tok)" }
  if (s.includes("reject") || s.includes("fail"))
    return { label: "Mismatch", bg: "var(--sdn)", fg: "var(--tdn)" }
  return { label: "Unverified", bg: "var(--swn)", fg: "var(--twn)" }
}
