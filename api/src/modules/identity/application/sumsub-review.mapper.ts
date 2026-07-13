import type { SumsubWebhookPayload } from '@handshake-agent/contracts';

import { tierBelow } from '../domain/tier-order';
import type { KycTierValue } from './ports/kyc-provider.port';

/** Result of mapping a Sumsub webhook payload to a tier-grant decision. */
export interface SumsubReviewMapping {
  userId: string;
  status: 'verified' | 'rejected' | 'pending_review';
  grantTier?: KycTierValue;
  /**
   * Set only on a RED verdict at a KNOWN level (root CLAUDE.md's Sumsub
   * compliance policy): the rung directly below the level that failed
   * verification — a tier_2-level RED (doc+liveness) downgrades to tier_1; a
   * tier_3-level RED (proof-of-address) downgrades to tier_2. Absent for an
   * unknown/unmapped `levelName` (fail-safe — no downgrade, rejection only)
   * and for every non-RED status.
   */
  downgradeTo?: KycTierValue;
  reason?: string;
}

/**
 * Maps a Sumsub webhook payload (contracts layer) to a tier-grant decision.
 *
 * Pure function — no I/O, no DI, no throws for well-formed-but-unexpected
 * payloads. The caller (the webhook handler) is responsible for actually
 * granting the tier; this function only decides what, if anything, should
 * happen.
 *
 * Fail-safe by construction: a tier is granted **only** when Sumsub reports
 * `reviewAnswer === 'GREEN'` AND the webhook's `levelName` is a recognized
 * key in `levelToTier`. Every other shape — an unrecognized level, a RED
 * verdict, or a webhook with no `reviewResult` at all (e.g. an
 * `applicantPending`/`applicantCreated` event) — resolves to a non-granting
 * status so an unrecognized Sumsub level can never silently unlock a tier.
 */
export function mapSumsubReview(
  payload: SumsubWebhookPayload,
  levelToTier: Record<string, KycTierValue>,
): SumsubReviewMapping {
  const { externalUserId: userId, reviewResult } = payload;

  if (!reviewResult) {
    return { userId, status: 'pending_review' };
  }

  if (reviewResult.reviewAnswer === 'RED') {
    return {
      userId,
      status: 'rejected',
      reason: rejectReason(reviewResult),
      ...redDowngrade(payload.levelName, levelToTier),
    };
  }

  // reviewAnswer === 'GREEN'
  const grantTier = payload.levelName
    ? levelToTier[payload.levelName]
    : undefined;
  if (!grantTier) {
    return { userId, status: 'pending_review' };
  }

  return { userId, status: 'verified', grantTier };
}

/**
 * Computes the RED-downgrade target: the rung below the level whose
 * verification failed. Returns `{}` (no `downgradeTo` key at all — not an
 * explicit `undefined`) when `levelName` is absent, unrecognized in
 * `levelToTier`, or already at the floor — fail-safe by construction, mirroring
 * `mapSumsubReview`'s own fail-safe posture on the GREEN/unknown-level path.
 */
function redDowngrade(
  levelName: string | undefined,
  levelToTier: Record<string, KycTierValue>,
): { downgradeTo: KycTierValue } | Record<string, never> {
  const levelTier = levelName ? levelToTier[levelName] : undefined;
  if (!levelTier) return {};

  const below = tierBelow(levelTier);
  return below ? { downgradeTo: below } : {};
}

function rejectReason(
  reviewResult: NonNullable<SumsubWebhookPayload['reviewResult']>,
): string {
  if (reviewResult.rejectLabels?.length) {
    return reviewResult.rejectLabels.join(', ');
  }
  if (reviewResult.reviewRejectType) {
    return `Sumsub review rejected (${reviewResult.reviewRejectType})`;
  }
  return 'Sumsub review rejected';
}
