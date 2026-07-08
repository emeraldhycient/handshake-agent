/** "tier_1" → "Tier 1"; "unverified" → "Unverified" (shared by the settings sections). */
export function tierLabel(tier: string): string {
  if (tier === "unverified") return "Unverified"
  return tier.replace(/^tier_/, "Tier ")
}
