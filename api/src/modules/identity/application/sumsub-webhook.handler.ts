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
 *     IKycRepository.markSumsubRejected (kycStatus=rejected AND a fail-closed
 *     tier re-lock to the tier_1 floor — an unmappable adverse finding must not
 *     leave elevated tier_2/tier_3 capabilities open under the tier-only gate).
 *   - rejected, with downgradeTo (RED at a KNOWN level — the compliance
 *     policy: a level's RED drops the user to the rung below it) →
 *     IKycRepository.downgradeSumsubTier (atomic, idempotent, never raises a
 *     tier — re-locks send/sell/swap at the lower tier's gate, §3.3).
 *   Either RED path (for a known user) additionally raises an idempotent
 *   `kyc_escalation` ComplianceEvent flag (status `flagged`) so an operator
 *   reviews the post-approval RED — the human backstop that can reinstate a
 *   false positive the deterministic downgrade would otherwise lock out.
 *   This is the hybrid compliance policy for post-GREEN REDs (see
 *   docs/superpowers/specs — auto-downgrade for containment + flag for review).
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

import {
  SumsubWebhookPayloadSchema,
  type SumsubWebhookPayload,
} from '@handshake-agent/contracts';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { SumsubConfig } from '../../../core/config/configuration';
import {
  COMPLIANCE_EVENT_REPOSITORY,
  type IComplianceEventRepository,
  type SeverityValue,
} from '../../compliance/application/ports/compliance-event.repository.port';
import type { WebhookHandler } from '../../webhooks/application/ports/webhook-handler.port';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';
import {
  KYC_REPOSITORY,
  type IKycRepository,
} from './ports/kyc.repository.port';
import type { KycTierValue } from './ports/kyc-provider.port';
import {
  mapSumsubReview,
  type SumsubReviewMapping,
} from './sumsub-review.mapper';

@Injectable()
export class SumsubWebhookHandler implements WebhookHandler {
  readonly provider = 'sumsub';
  private readonly logger = new Logger(SumsubWebhookHandler.name);

  constructor(
    @Inject(KYC_REPOSITORY) private readonly kycRepo: IKycRepository,
    @Inject(COMPLIANCE_EVENT_REPOSITORY)
    private readonly complianceEvents: IComplianceEventRepository,
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
      await this.applyRejection(payload, mapping);
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
   * A RED review ALWAYS re-locks the TIER (so a rejected account can never
   * retain elevated capabilities under the tier-only money gate): when the
   * mapper resolved a `downgradeTo` (a KNOWN level), `downgradeSumsubTier` drops
   * the user to the rung below the failed level; for an unmapped/absent level,
   * `markSumsubRejected` fails closed to the tier_1 (email-verified) floor.
   * Both repo calls share the same `{ found }` no-op shape for an unknown
   * externalUserId. On top of that deterministic containment, a known-user RED
   * also raises the `kyc_escalation` compliance flag (the human backstop half of
   * the hybrid policy) carrying the effective re-lock target.
   */
  private async applyRejection(
    payload: SumsubWebhookPayload,
    mapping: SumsubReviewMapping,
  ): Promise<void> {
    const { userId, downgradeTo } = mapping;
    const resolvedReason = mapping.reason ?? 'Sumsub review rejected';
    // The effective tier cap after this RED: one rung below a known level, or
    // the tier_1 floor for an unmapped/absent level. Surfaced on the flag.
    const relockedTo: KycTierValue = downgradeTo ?? 'tier_1';

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
      return;
    }

    await this.raiseKycEscalationFlag(
      payload,
      mapping,
      resolvedReason,
      relockedTo,
    );
  }

  /**
   * Raises a single `kyc_escalation` compliance flag for a post-approval RED so
   * an operator reviews it (and can reinstate a false positive the auto-
   * downgrade would otherwise lock out). Idempotent: the existence guard
   * (`findLatestOpenByUserAndType`) makes flag-raising safe under the webhook
   * queue's at-least-once retry and prevents piling duplicate OPEN cases when a
   * fresh RED arrives while an earlier flag is still undisposed. Flag `details`
   * are derived from the payload (stable across retries), never from the
   * observed pre/post tier — so a retry after a partial-failure never records a
   * misleading "downgraded from".
   */
  private async raiseKycEscalationFlag(
    payload: SumsubWebhookPayload,
    mapping: SumsubReviewMapping,
    reason: string,
    relockedTo: KycTierValue,
  ): Promise<void> {
    const { userId } = mapping;

    const existing = await this.complianceEvents.findLatestOpenByUserAndType(
      userId,
      'kyc_escalation',
    );
    if (existing) {
      this.logger.log(
        { userId, existingEventId: existing.id },
        'Sumsub webhook: RED review — an open kyc_escalation flag already exists, skipping duplicate',
      );
      return;
    }

    const reviewRejectType = payload.reviewResult?.reviewRejectType;
    // A FINAL rejection is an authoritative adverse finding; a RETRY only asks
    // for resubmission (self-healing — a later GREEN restores the tier via
    // grantSumsubTier). Severity reflects that, while both still raise a
    // reviewable flag. `critical` stays reserved for sanctions-class hits.
    const severity: SeverityValue =
      reviewRejectType === 'FINAL' ? 'high' : 'medium';

    await this.complianceEvents.create({
      userId,
      transactionId: null,
      eventType: 'kyc_escalation',
      severity,
      screeningProvider: 'sumsub',
      ruleOrHit: reason,
      details: {
        source: 'sumsub_review',
        reviewAnswer: 'RED',
        reviewRejectType: reviewRejectType ?? null,
        levelName: payload.levelName ?? null,
        rejectLabels: payload.reviewResult?.rejectLabels ?? [],
        downgradedTo: relockedTo,
        applicantId: payload.applicantId ?? null,
      },
      status: 'flagged',
    });

    this.logger.warn(
      { userId, severity, downgradedTo: relockedTo },
      'Sumsub webhook: RED review — raised kyc_escalation compliance flag for manual review',
    );
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
