import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  EnqueueVerificationInput,
  EnqueueVerificationResult,
  IVerificationOutboxRepository,
} from '../application/ports/verification-outbox.repository.port';

/**
 * The outbox event type for an admin-initiated verification/onboarding nudge. The
 * `NotificationEventType` enum has no generic "onboarding" member; a re-sent
 * verification email is the review/onboarding lifecycle, so it rides the
 * `kyc_pending_review` type — a documented mapping, not a fabricated value.
 */
const VERIFICATION_EVENT_TYPE = 'kyc_pending_review' as const;

/**
 * Prisma adapter for IVerificationOutboxRepository (admin resend-verification,
 * Phase 9). Infrastructure layer only — the sole place in this feature that imports
 * the generated Prisma client / PrismaService (§3.2 / §4). Inserts ONE verification
 * `Notification` into the outbox; the deterministic dispatch worker then renders +
 * sends it, so no email provider is called here. Moves no money (§3.1).
 *
 * IDEMPOTENCY: the row is `upsert`ed on the outbox's `(eventRef, eventType)` unique
 * with an EMPTY update, so an accidental same-request replay returns the existing
 * row unchanged rather than double-sending. A fresh resend carries a fresh eventRef
 * (the operator's intent is to send again).
 */
@Injectable()
export class VerificationOutboxPrismaRepository implements IVerificationOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async enqueueVerification(
    input: EnqueueVerificationInput,
  ): Promise<EnqueueVerificationResult> {
    const row = await this.prisma.notification.upsert({
      where: {
        eventRef_eventType: {
          eventRef: input.eventRef,
          eventType: VERIFICATION_EVENT_TYPE,
        },
      },
      // Replay is a no-op — the already-enqueued row is returned unchanged.
      update: {},
      create: {
        userId: input.userId,
        eventType: VERIFICATION_EVENT_TYPE,
        eventRef: input.eventRef,
        templateKey: input.templateKey,
        templateVars: input.templateVars as Prisma.InputJsonValue,
        // Onboarding nudge — the user's comms preferences may suppress it.
        isDisableable: true,
      },
      select: { id: true },
    });

    return { notificationId: row.id };
  }
}
