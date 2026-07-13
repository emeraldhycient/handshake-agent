/**
 * SumsubWebhookHandler — the async processing body for Sumsub `applicantReviewed`
 * (and related) webhooks (task 3.6). This is the ONLY writer of a KYC
 * status/tier transition once a Sumsub review has posted (root CLAUDE.md
 * §3.1/§3.3 — the model never grants a tier; only this deterministic handler,
 * running on a verified+persisted event, does).
 *
 * Runs in the worker (WebhookProcessor → registry) on a persisted WebhookEvent,
 * AFTER the controller (SumsubWebhookController) has verified the signature.
 * Parses+validates the payload, maps it to a decision via the pure
 * `mapSumsubReview` (task 3.5), then applies:
 *   - verified + grantTier → IKycRepository.grantSumsubTier (atomic, idempotent,
 *     no-downgrade — a replayed/out-of-order GREEN never re-stamps
 *     tierChangedAt or downgrades an already-higher tier).
 *   - rejected, no downgradeTo (unknown/unmapped level, fail-safe) →
 *     IKycRepository.markSumsubRejected (kycStatus only; tier untouched).
 *   - rejected, with downgradeTo (RED at a KNOWN level — the compliance
 *     policy: a level's RED drops the user to the rung below it) →
 *     IKycRepository.downgradeSumsubTier (atomic, idempotent, never raises a
 *     tier — re-locks send/sell/swap at the lower tier's gate, §3.3).
 *   - pending_review (no reviewResult, OR GREEN with an unrecognized level —
 *     the mapper's fail-safe) → IKycRepository.markSumsubPendingReview
 *     (guarded: never un-verifies an already-verified user).
 *
 * An unknown externalUserId (no matching User) is logged and acked as a no-op
 * — the webhook was signature-valid; a user mismatch is not a retryable
 * failure and must never throw. A payload that fails schema validation is
 * likewise logged and acked without processing (malformed/unexpected Sumsub
 * event shapes must never crash the durable queue).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { SumsubWebhookPayloadSchema } from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { SumsubConfig } from '../../../core/config/configuration';
import type { WebhookHandler } from '../../webhooks/application/ports/webhook-handler.port';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';
import {
  KYC_REPOSITORY,
  type IKycRepository,
} from './ports/kyc.repository.port';
import type { KycTierValue } from './ports/kyc-provider.port';
import { mapSumsubReview } from './sumsub-review.mapper';

@Injectable()
export class SumsubWebhookHandler implements WebhookHandler {
  readonly provider = 'sumsub';
  private readonly logger = new Logger(SumsubWebhookHandler.name);

  constructor(
    @Inject(KYC_REPOSITORY) private readonly kycRepo: IKycRepository,
    private readonly config: EffectiveConfigService,
  ) {}

  async handle(event: WebhookEventRecord): Promise<void> {
    const parsed = SumsubWebhookPayloadSchema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn(
        { issues: parsed.error.issues },
        'Sumsub webhook: payload failed schema validation — acking without processing',
      );
      return;
    }

    const payload = parsed.data;
    const levelToTier = this.config.get<SumsubConfig>('sumsub').levelToTier;
    const mapping = mapSumsubReview(payload, levelToTier);

    if (mapping.status === 'verified' && mapping.grantTier) {
      await this.applyGrant(
        mapping.userId,
        mapping.grantTier,
        payload.applicantId,
      );
      return;
    }

    if (mapping.status === 'rejected') {
      await this.applyRejection(
        mapping.userId,
        mapping.reason,
        mapping.downgradeTo,
      );
      return;
    }

    await this.applyPendingReview(mapping.userId);
  }

  private async applyGrant(
    userId: string,
    grantTier: KycTierValue,
    applicantId: string | undefined,
  ): Promise<void> {
    const result = await this.kycRepo.grantSumsubTier({
      userId,
      tier: grantTier,
      applicantId,
    });

    this.logger.log(
      { userId, tier: grantTier, granted: result.granted },
      result.granted
        ? 'Sumsub webhook: GREEN review — tier granted'
        : 'Sumsub webhook: GREEN review — no-op (unknown user, or already at/above the granted tier)',
    );
  }

  /**
   * A RED review either revokes verified STATUS only (`markSumsubRejected` —
   * unknown/unmapped `levelName`, the mapper's fail-safe) or, when the mapper
   * resolved a `downgradeTo`, also auto-downgrades the tier
   * (`downgradeSumsubTier` — the compliance policy: a RED at a level drops
   * the user to the rung below it, re-locking send/sell/swap at the lower
   * tier's gate). Both repo calls share the same `{ found }` no-op shape for
   * an unknown externalUserId.
   */
  private async applyRejection(
    userId: string,
    reason: string | undefined,
    downgradeTo: KycTierValue | undefined,
  ): Promise<void> {
    const resolvedReason = reason ?? 'Sumsub review rejected';
    const result = downgradeTo
      ? await this.kycRepo.downgradeSumsubTier(
          userId,
          downgradeTo,
          resolvedReason,
        )
      : await this.kycRepo.markSumsubRejected(userId, resolvedReason);

    if (!result.found) {
      this.logger.warn(
        { userId },
        'Sumsub webhook: RED review for unknown user — acking without processing',
      );
    }
  }

  private async applyPendingReview(userId: string): Promise<void> {
    const result = await this.kycRepo.markSumsubPendingReview(userId);
    if (!result.found) {
      this.logger.warn(
        { userId },
        'Sumsub webhook: pending-review event for unknown user — acking without processing',
      );
    }
  }
}
