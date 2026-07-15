import type { KycTierLevel } from "@handshake-agent/contracts/dto"

/** "tier_1" → "Tier 1"; "unverified" → "Unverified" (shared by the settings sections). */
export function tierLabel(tier: string): string {
  if (tier === "unverified") return "Unverified"
  return tier.replace(/^tier_/, "Tier ")
}

/** 0..3 rung the tier occupies on the 3-step ladder (drives the membership ring). */
export function tierNumber(tier: string): number {
  if (tier === "tier_3") return 3
  if (tier === "tier_2") return 2
  if (tier === "tier_1") return 1
  return 0
}

/** Total rungs on the KYC ladder ("… of 3"). */
export const MAX_TIER = 3

/**
 * The next KYC level to verify toward, or null at the top. Below tier_2 the
 * next step is always document + liveness (tier_2). Shared by the membership
 * card's verify CTA and the verification flow.
 */
export function nextKycLevel(kycTier: string): KycTierLevel | null {
  if (kycTier === "tier_3") return null
  if (kycTier === "tier_2") return "tier_3"
  return "tier_2"
}
