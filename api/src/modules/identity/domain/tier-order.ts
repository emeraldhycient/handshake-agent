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

/** Tiers ordered low → high; index mirrors `TIER_ORDER`'s ordinal values. */
const TIER_SEQUENCE: readonly KycTier[] = [
  'unverified',
  'tier_1',
  'tier_2',
  'tier_3',
];

/**
 * The tier one rung below `tier`, or `null` when `tier` is already the floor
 * (`unverified` — nothing sits below it).
 *
 * Backs the Sumsub RED auto-downgrade compliance policy (root CLAUDE.md's
 * KYC-gating invariant, §3.3): a RED verdict at a given level means THAT
 * level's verification failed, so the user drops to the rung below it —
 * `tierBelow('tier_2')` → `'tier_1'`, `tierBelow('tier_3')` → `'tier_2'`.
 */
export const tierBelow = (tier: KycTier): KycTier | null => {
  const index = TIER_ORDER[tier];
  return index > 0 ? TIER_SEQUENCE[index - 1] : null;
};

/** Fail-closed minimum tier for a capability with no configured map entry. */
const FAIL_CLOSED_MIN_TIER: KycTier = 'tier_2';

/**
 * True when `kycTier` meets the minimum tier configured for `capability` in
 * `capabilityMinTierMap` (the `gating.capabilityMinTier` config map — root
 * CLAUDE.md §7 / Task 1.2). This is the SAME check the deterministic engine
 * runs (`KycGateService.assertBaselineEligibility`,
 * `api/src/modules/identity/application/kyc-gate.service.ts`) — kept here as a
 * pure domain helper so every call site (the engine's authoritative gate AND
 * any chat-entry pre-check) shares one source of truth for the mapping instead
 * of re-deriving it. Fails closed to `tier_2` when `capability` has no entry in
 * `capabilityMinTierMap`, mirroring the engine's `FAIL_CLOSED_MIN_TIER`.
 */
export const meetsCapabilityMinTier = (
  kycTier: KycTier,
  capability: string,
  capabilityMinTierMap: Record<string, KycTier>,
): boolean => {
  const requiredTier = capabilityMinTierMap[capability] ?? FAIL_CLOSED_MIN_TIER;
  return tierAtLeast(kycTier, requiredTier);
};
