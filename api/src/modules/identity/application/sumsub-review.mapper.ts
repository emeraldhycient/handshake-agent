import type { SumsubWebhookPayload } from '@handshake-agent/contracts';

import type { KycTierValue } from './ports/kyc-provider.port';

/** Result of mapping a Sumsub webhook payload to a tier-grant decision. */
export interface SumsubReviewMapping {
  userId: string;
  status: 'verified' | 'rejected' | 'pending_review';
  grantTier?: KycTierValue;
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
    return { userId, status: 'rejected', reason: rejectReason(reviewResult) };
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
