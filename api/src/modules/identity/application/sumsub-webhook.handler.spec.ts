/**
 * Unit tests for SumsubWebhookHandler (task 3.6).
 *
 * The handler parses+validates the payload, maps it via the pure
 * `mapSumsubReview` (task 3.5, already unit-tested in sumsub-review.mapper.spec.ts),
 * and dispatches to the focused IKycRepository writes. These tests verify the
 * DISPATCH logic and the funds-safety guarantees (idempotent grant, guarded
 * pending, unknown-user no-op, malformed-payload no-op) — not the mapper's own
 * decision table (covered elsewhere) or the repository's atomicity (covered in
 * kyc.prisma.repository.spec.ts).
 */

import { Logger } from '@nestjs/common';

import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';
import type { IKycRepository } from './ports/kyc.repository.port';
import { SumsubWebhookHandler } from './sumsub-webhook.handler';

const LEVEL_TO_TIER = {
  'id-and-liveness': 'tier_2',
  'full-kyc': 'tier_3',
};

function makeConfig(): EffectiveConfigService {
  return {
    get: jest.fn().mockReturnValue({
      mockMode: true,
      baseUrl: 'https://api.sumsub.com',
      levelToTier: LEVEL_TO_TIER,
    }),
  } as unknown as EffectiveConfigService;
}

function makeEvent(payload: unknown): WebhookEventRecord {
  return {
    id: 'wh-1',
    provider: 'sumsub',
    providerEventId: 'evt-1',
    payload,
    headers: {},
    signature: null,
    status: 'processing',
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    lastAttemptAt: new Date(),
    processedAt: null,
    deadAt: null,
  };
}

function makeRepo(
  overrides: Partial<jest.Mocked<IKycRepository>> = {},
): jest.Mocked<IKycRepository> {
  return {
    completeVerificationAtomic: jest.fn(),
    completeVerificationForUserAtomic: jest.fn(),
    updateKycProfileDecision: jest.fn(),
    markKycNeedsInfo: jest.fn(),
    setSumsubApplicantId: jest.fn(),
    grantSumsubTier: jest.fn().mockResolvedValue({ granted: true }),
    markSumsubRejected: jest.fn().mockResolvedValue({ found: true }),
    markSumsubPendingReview: jest.fn().mockResolvedValue({ found: true }),
    ...overrides,
  };
}

describe('SumsubWebhookHandler', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('provider is "sumsub"', () => {
    const handler = new SumsubWebhookHandler(makeRepo(), makeConfig());
    expect(handler.provider).toBe('sumsub');
  });

  it('GREEN + known level → grants the mapped tier, with the applicantId threaded through', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(repo, makeConfig());

    await handler.handle(
      makeEvent({
        type: 'applicantReviewed',
        externalUserId: 'user-1',
        applicantId: 'app-1',
        levelName: 'id-and-liveness',
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
    );

    expect(repo.grantSumsubTier).toHaveBeenCalledWith({
      userId: 'user-1',
      tier: 'tier_2',
      applicantId: 'app-1',
    });
    expect(repo.markSumsubRejected).not.toHaveBeenCalled();
    expect(repo.markSumsubPendingReview).not.toHaveBeenCalled();
  });

  it('GREEN + tier_3 level → grants tier_3', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(repo, makeConfig());

    await handler.handle(
      makeEvent({
        type: 'applicantReviewed',
        externalUserId: 'user-1',
        levelName: 'full-kyc',
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
    );

    expect(repo.grantSumsubTier).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'tier_3' }),
    );
  });

  it('idempotent GREEN redelivery (repo reports granted:false) → does not throw, logs no-op', async () => {
    const repo = makeRepo({
      grantSumsubTier: jest.fn().mockResolvedValue({ granted: false }),
    });
    const handler = new SumsubWebhookHandler(repo, makeConfig());

    await expect(
      handler.handle(
        makeEvent({
          type: 'applicantReviewed',
          externalUserId: 'user-1',
          levelName: 'id-and-liveness',
          reviewResult: { reviewAnswer: 'GREEN' },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(repo.grantSumsubTier).toHaveBeenCalledTimes(1);
  });

  it('RED → marks rejected with the mapped reason, never touches the grant path', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(repo, makeConfig());

    await handler.handle(
      makeEvent({
        type: 'applicantReviewed',
        externalUserId: 'user-2',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
    );

    expect(repo.markSumsubRejected).toHaveBeenCalledWith(
      'user-2',
      expect.stringContaining('FINAL'),
    );
    expect(repo.grantSumsubTier).not.toHaveBeenCalled();
  });

  it('no reviewResult (applicantPending) → marks pending_review', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(repo, makeConfig());

    await handler.handle(
      makeEvent({ type: 'applicantPending', externalUserId: 'user-3' }),
    );

    expect(repo.markSumsubPendingReview).toHaveBeenCalledWith('user-3');
    expect(repo.grantSumsubTier).not.toHaveBeenCalled();
    expect(repo.markSumsubRejected).not.toHaveBeenCalled();
  });

  it('GREEN + unrecognized level → pending_review, no grant (fail-safe passthrough from the mapper)', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(repo, makeConfig());

    await handler.handle(
      makeEvent({
        type: 'applicantReviewed',
        externalUserId: 'user-4',
        levelName: 'some-unregistered-level',
        reviewResult: { reviewAnswer: 'GREEN' },
      }),
    );

    expect(repo.markSumsubPendingReview).toHaveBeenCalledWith('user-4');
    expect(repo.grantSumsubTier).not.toHaveBeenCalled();
  });

  it('unknown externalUserId (repo reports not found) → does not throw', async () => {
    const repo = makeRepo({
      markSumsubPendingReview: jest.fn().mockResolvedValue({ found: false }),
    });
    const handler = new SumsubWebhookHandler(repo, makeConfig());

    await expect(
      handler.handle(
        makeEvent({ type: 'applicantCreated', externalUserId: 'no-such-user' }),
      ),
    ).resolves.toBeUndefined();
  });

  it('malformed payload (fails schema validation) → does not throw, makes no repo calls', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(repo, makeConfig());

    await expect(
      handler.handle(makeEvent({ nope: true })),
    ).resolves.toBeUndefined();

    expect(repo.grantSumsubTier).not.toHaveBeenCalled();
    expect(repo.markSumsubRejected).not.toHaveBeenCalled();
    expect(repo.markSumsubPendingReview).not.toHaveBeenCalled();
  });
});
