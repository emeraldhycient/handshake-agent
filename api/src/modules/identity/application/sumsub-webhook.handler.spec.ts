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
import type { IComplianceEventRepository } from '../../compliance/application/ports/compliance-event.repository.port';
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
    downgradeSumsubTier: jest.fn().mockResolvedValue({ found: true }),
    ...overrides,
  };
}

function makeComplianceEvents(
  overrides: Partial<jest.Mocked<IComplianceEventRepository>> = {},
): jest.Mocked<IComplianceEventRepository> {
  return {
    create: jest.fn().mockResolvedValue({ id: 'ce-flag-1' }),
    listByStatus: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    findById: jest.fn().mockResolvedValue(null),
    findLatestOpenByUserAndType: jest.fn().mockResolvedValue(null),
    updateDisposition: jest.fn().mockResolvedValue(undefined),
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
    const handler = new SumsubWebhookHandler(
      makeRepo(),
      makeComplianceEvents(),
      makeConfig(),
    );
    expect(handler.provider).toBe('sumsub');
  });

  it('GREEN + known level → grants the mapped tier, with the applicantId threaded through', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

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
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

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
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

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
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

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
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

    await handler.handle(
      makeEvent({ type: 'applicantPending', externalUserId: 'user-3' }),
    );

    expect(repo.markSumsubPendingReview).toHaveBeenCalledWith('user-3');
    expect(repo.grantSumsubTier).not.toHaveBeenCalled();
    expect(repo.markSumsubRejected).not.toHaveBeenCalled();
  });

  it('GREEN + unrecognized level → pending_review, no grant (fail-safe passthrough from the mapper)', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

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
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

    await expect(
      handler.handle(
        makeEvent({ type: 'applicantCreated', externalUserId: 'no-such-user' }),
      ),
    ).resolves.toBeUndefined();
  });

  it('RED at the tier_2 level → calls downgradeSumsubTier(userId, tier_1, reason), never markSumsubRejected', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

    await handler.handle(
      makeEvent({
        type: 'applicantReviewed',
        externalUserId: 'user-5',
        levelName: 'id-and-liveness',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
    );

    expect(repo.downgradeSumsubTier).toHaveBeenCalledWith(
      'user-5',
      'tier_1',
      expect.stringContaining('FINAL'),
    );
    expect(repo.markSumsubRejected).not.toHaveBeenCalled();
  });

  it('RED at the tier_3 level → calls downgradeSumsubTier(userId, tier_2, reason)', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

    await handler.handle(
      makeEvent({
        type: 'applicantReviewed',
        externalUserId: 'user-6',
        levelName: 'full-kyc',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
    );

    expect(repo.downgradeSumsubTier).toHaveBeenCalledWith(
      'user-6',
      'tier_2',
      expect.any(String),
    );
    expect(repo.markSumsubRejected).not.toHaveBeenCalled();
  });

  it('RED with an unrecognized/absent level → falls back to markSumsubRejected, never downgradeSumsubTier', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

    await handler.handle(
      makeEvent({
        type: 'applicantReviewed',
        externalUserId: 'user-7',
        reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'FINAL' },
      }),
    );

    expect(repo.markSumsubRejected).toHaveBeenCalledWith(
      'user-7',
      expect.any(String),
    );
    expect(repo.downgradeSumsubTier).not.toHaveBeenCalled();
  });

  it('unknown externalUserId on a downgrade RED (repo reports not found) → does not throw', async () => {
    const repo = makeRepo({
      downgradeSumsubTier: jest.fn().mockResolvedValue({ found: false }),
    });
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

    await expect(
      handler.handle(
        makeEvent({
          type: 'applicantReviewed',
          externalUserId: 'no-such-user',
          levelName: 'id-and-liveness',
          reviewResult: { reviewAnswer: 'RED' },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('malformed payload (fails schema validation) → does not throw, makes no repo calls', async () => {
    const repo = makeRepo();
    const handler = new SumsubWebhookHandler(
      repo,
      makeComplianceEvents(),
      makeConfig(),
    );

    await expect(
      handler.handle(makeEvent({ nope: true })),
    ).resolves.toBeUndefined();

    expect(repo.grantSumsubTier).not.toHaveBeenCalled();
    expect(repo.markSumsubRejected).not.toHaveBeenCalled();
    expect(repo.markSumsubPendingReview).not.toHaveBeenCalled();
  });

  // =========================================================================
  // COMPLIANCE FLAG — the hybrid policy's human-review half. A post-approval
  // RED (for a known user) raises exactly one kyc_escalation flag, guarded by
  // findLatestOpenByUserAndType so retries / a still-open prior case don't pile
  // duplicates onto the reviewer's queue.
  // =========================================================================

  describe('kyc_escalation compliance flag (post-GREEN RED)', () => {
    function redEvent(
      userId: string,
      reviewResult: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ): WebhookEventRecord {
      return makeEvent({
        type: 'applicantReviewed',
        externalUserId: userId,
        reviewResult: { reviewAnswer: 'RED', ...reviewResult },
        ...extra,
      });
    }

    it('RED at a known level (FINAL) → raises one flag: kyc_escalation, severity high, provider sumsub, downgradedTo in details', async () => {
      const compliance = makeComplianceEvents();
      const handler = new SumsubWebhookHandler(
        makeRepo(),
        compliance,
        makeConfig(),
      );

      await handler.handle(
        redEvent(
          'user-flag-1',
          { reviewRejectType: 'FINAL', rejectLabels: ['FORGERY'] },
          { levelName: 'id-and-liveness', applicantId: 'app-red-1' },
        ),
      );

      expect(compliance.findLatestOpenByUserAndType).toHaveBeenCalledWith(
        'user-flag-1',
        'kyc_escalation',
      );
      expect(compliance.create).toHaveBeenCalledTimes(1);
      const flag = compliance.create.mock.calls[0][0];
      expect(flag).toEqual(
        expect.objectContaining({
          userId: 'user-flag-1',
          eventType: 'kyc_escalation',
          severity: 'high',
          screeningProvider: 'sumsub',
          status: 'flagged',
        }),
      );
      expect(flag.details).toEqual({
        source: 'sumsub_review',
        reviewAnswer: 'RED',
        reviewRejectType: 'FINAL',
        levelName: 'id-and-liveness',
        rejectLabels: ['FORGERY'],
        downgradedTo: 'tier_1',
        applicantId: 'app-red-1',
      });
    });

    it('RETRY reject type → severity medium (recoverable — a later GREEN restores the tier)', async () => {
      const compliance = makeComplianceEvents();
      const handler = new SumsubWebhookHandler(
        makeRepo(),
        compliance,
        makeConfig(),
      );

      await handler.handle(
        redEvent(
          'user-flag-2',
          { reviewRejectType: 'RETRY' },
          { levelName: 'id-and-liveness' },
        ),
      );

      expect(compliance.create).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'medium' }),
      );
    });

    it('RED at an unmapped level (fail-closed) STILL raises a flag, recording the tier_1 re-lock floor', async () => {
      const compliance = makeComplianceEvents();
      const repo = makeRepo();
      const handler = new SumsubWebhookHandler(repo, compliance, makeConfig());

      await handler.handle(
        redEvent('user-flag-3', { reviewRejectType: 'FINAL' }),
      );

      expect(repo.markSumsubRejected).toHaveBeenCalled();
      expect(repo.downgradeSumsubTier).not.toHaveBeenCalled();
      const flag = compliance.create.mock.calls[0][0];
      expect(flag.eventType).toBe('kyc_escalation');
      // The unmapped-level RED fails closed to the tier_1 floor; the flag records
      // that effective re-lock target (not null — the tier IS re-locked).
      expect(flag.details).toEqual(
        expect.objectContaining({ downgradedTo: 'tier_1' }),
      );
    });

    it('an open kyc_escalation flag already exists → does NOT create a duplicate (idempotent guard)', async () => {
      const compliance = makeComplianceEvents({
        findLatestOpenByUserAndType: jest
          .fn()
          .mockResolvedValue({ id: 'existing-flag', status: 'flagged' }),
      });
      const handler = new SumsubWebhookHandler(
        makeRepo(),
        compliance,
        makeConfig(),
      );

      await handler.handle(
        redEvent(
          'user-flag-4',
          { reviewRejectType: 'FINAL' },
          { levelName: 'id-and-liveness' },
        ),
      );

      expect(compliance.create).not.toHaveBeenCalled();
    });

    it('unknown user (repo reports not found) → no flag raised, no dedup query', async () => {
      const compliance = makeComplianceEvents();
      const repo = makeRepo({
        downgradeSumsubTier: jest.fn().mockResolvedValue({ found: false }),
      });
      const handler = new SumsubWebhookHandler(repo, compliance, makeConfig());

      await handler.handle(
        redEvent(
          'no-such-user',
          { reviewRejectType: 'FINAL' },
          { levelName: 'id-and-liveness' },
        ),
      );

      expect(compliance.findLatestOpenByUserAndType).not.toHaveBeenCalled();
      expect(compliance.create).not.toHaveBeenCalled();
    });

    it('a GREEN grant raises no flag', async () => {
      const compliance = makeComplianceEvents();
      const handler = new SumsubWebhookHandler(
        makeRepo(),
        compliance,
        makeConfig(),
      );

      await handler.handle(
        makeEvent({
          type: 'applicantReviewed',
          externalUserId: 'user-flag-6',
          levelName: 'id-and-liveness',
          reviewResult: { reviewAnswer: 'GREEN' },
        }),
      );

      expect(compliance.create).not.toHaveBeenCalled();
    });
  });
});
