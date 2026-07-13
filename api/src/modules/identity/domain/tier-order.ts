/**
 * Pure KYC-tier ordering helper (domain layer — CLAUDE.md §4.1).
 *
 * Typed against `KycTier` from `@handshake-agent/contracts` (type-only import,
 * so this stays a compile-time-only dependency with no runtime coupling).
 * Do NOT import `KycTierValue` from the identity `application` layer's
 * `kyc-provider.port.ts` — a `domain → application` import breaks the
 * dependency-cruiser boundary (root CLAUDE.md §3.2 / §4.1).
 */
import type { KycTier } from '@handshake-agent/contracts';

/** Ordinal rank of each KYC tier, lowest (`unverified`) to highest (`tier_3`). */
export const TIER_ORDER: Record<KycTier, number> = {
  unverified: 0,
  tier_1: 1,
  tier_2: 2,
  tier_3: 3,
};

/** True when `actual` is at or above `required` in the tier ordering. */
export const tierAtLeast = (actual: KycTier, required: KycTier): boolean =>
  TIER_ORDER[actual] >= TIER_ORDER[required];
