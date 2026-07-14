import type { SumsubWebhookPayload } from '@handshake-agent/contracts';

import type { KycTierValue } from './ports/kyc-provider.port';
import { mapSumsubReview } from './sumsub-review.mapper';

const LEVEL_TO_TIER: Record<string, KycTierValue> = {
  'id-and-liveness': 'tier_2',
  'full-kyc': 'tier_3',
};

function payload(
  overrides: Partial<SumsubWebhookPayload>,
): SumsubWebhookPayload {
  return {
    type: 'applicantReviewed',
    externalUserId: 'user-123',
    ...overrides,
  };
}

describe('mapSumsubReview', () => {
  it('always echoes externalUserId as userId', () => {
    const result = mapSumsubReview(
      payload({ externalUserId: 'user-abc' }),
      LEVEL_TO_TIER,
    );
    expect(result.userId).toBe('user-abc');
  });

  it('GREEN + known tier_2 level → verified + tier_2, no reason', () => {
    const result = mapSumsubReview(
      payload({
        levelName: 'id-and-liveness',
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result).toEqual({
      userId: 'user-123',
      status: 'verified',
      grantTier: 'tier_2',
    });
  });

  it('GREEN + known tier_3 level → verified + tier_3', () => {
    const result = mapSumsubReview(
      payload({
        levelName: 'full-kyc',
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('verified');
    expect(result.grantTier).toBe('tier_3');
  });

  it('GREEN + unknown levelName → pending_review, NO grant (fail-safe)', () => {
    const result = mapSumsubReview(
      payload({
        levelName: 'some-unregistered-level',
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('pending_review');
    expect(result.grantTier).toBeUndefined();
  });

  it('GREEN + absent levelName → pending_review, NO grant', () => {
    const result = mapSumsubReview(
      payload({
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('pending_review');
    expect(result.grantTier).toBeUndefined();
  });

  it('RED with FINAL reject type → rejected with a reason, no grant', () => {
    const result = mapSumsubReview(
      payload({
        levelName: 'id-and-liveness',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('rejected');
    expect(result.grantTier).toBeUndefined();
    expect(result.reason).toBeTruthy();
  });

  it('RED with rejectLabels → reason includes the labels', () => {
    const result = mapSumsubReview(
      payload({
        reviewResult: {
          reviewAnswer: 'RED',
          reviewRejectType: 'FINAL',
          rejectLabels: ['DOCUMENT_TEMPLATE', 'FRAUDULENT_PATTERNS'],
        },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('DOCUMENT_TEMPLATE');
    expect(result.reason).toContain('FRAUDULENT_PATTERNS');
  });

  it('RED with no rejectLabels falls back to reviewRejectType in the reason', () => {
    const result = mapSumsubReview(
      payload({
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('RETRY');
  });

  it('RED with neither rejectLabels nor reviewRejectType still returns a generic reason', () => {
    const result = mapSumsubReview(
      payload({
        reviewResult: { reviewAnswer: 'RED' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('rejected');
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it('no reviewResult at all (e.g. applicantPending/applicantCreated) → pending_review, no grant', () => {
    const result = mapSumsubReview(
      payload({ type: 'applicantPending' }),
      LEVEL_TO_TIER,
    );

    expect(result).toEqual({
      userId: 'user-123',
      status: 'pending_review',
    });
  });

  it('no reviewResult and no levelName → pending_review, no grant', () => {
    const result = mapSumsubReview(
      payload({ type: 'applicantCreated' }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('pending_review');
    expect(result.grantTier).toBeUndefined();
  });
});

describe('mapSumsubReview — RED auto-downgrade (compliance policy)', () => {
  it('RED at the tier_2 level (doc+liveness) → downgradeTo tier_1', () => {
    const result = mapSumsubReview(
      payload({
        levelName: 'id-and-liveness',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('rejected');
    expect(result.downgradeTo).toBe('tier_1');
  });

  it('RED at the tier_3 level (proof-of-address) → downgradeTo tier_2', () => {
    const result = mapSumsubReview(
      payload({
        levelName: 'full-kyc',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('rejected');
    expect(result.downgradeTo).toBe('tier_2');
  });

  it('RED at an unrecognized level → NO downgradeTo (fail-safe), still rejected', () => {
    const result = mapSumsubReview(
      payload({
        levelName: 'some-unregistered-level',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('rejected');
    expect(result.downgradeTo).toBeUndefined();
  });

  it('RED with no levelName at all → NO downgradeTo', () => {
    const result = mapSumsubReview(
      payload({
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.status).toBe('rejected');
    expect(result.downgradeTo).toBeUndefined();
  });

  it('GREEN paths never carry downgradeTo', () => {
    const result = mapSumsubReview(
      payload({
        levelName: 'id-and-liveness',
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
      LEVEL_TO_TIER,
    );

    expect(result.downgradeTo).toBeUndefined();
  });

  it('pending_review paths never carry downgradeTo', () => {
    const result = mapSumsubReview(
      payload({ type: 'applicantPending' }),
      LEVEL_TO_TIER,
    );

    expect(result.downgradeTo).toBeUndefined();
  });
});
