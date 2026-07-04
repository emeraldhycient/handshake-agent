import { VerificationOutboxPrismaRepository } from './verification-outbox.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';

function buildMockPrisma(upsert: jest.Mock): PrismaService {
  return {
    notification: { upsert },
  } as unknown as PrismaService;
}

describe('VerificationOutboxPrismaRepository', () => {
  const input = {
    userId: 'user-1',
    eventRef: 'verification-resend:abc',
    templateKey: 'onboarding.verification.resend',
    templateVars: { userId: 'user-1', reason: null },
  };

  it('upserts one idempotent outbox row (keyed on the compound unique) and maps the id', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'ntf-1' });
    const repo = new VerificationOutboxPrismaRepository(
      buildMockPrisma(upsert),
    );

    const result = await repo.enqueueVerification(input);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      // Idempotency: targets the outbox (eventRef, eventType) unique with our ref;
      // an empty update makes a same-request replay a no-op (existing row returned).
      where: {
        eventRef_eventType: {
          eventRef: 'verification-resend:abc',
          eventType: 'kyc_pending_review',
        },
      },
      update: {},
      create: {
        userId: 'user-1',
        eventType: 'kyc_pending_review',
        eventRef: 'verification-resend:abc',
        templateKey: 'onboarding.verification.resend',
        templateVars: { userId: 'user-1', reason: null },
        // Onboarding nudge — the user's comms preferences may suppress it.
        isDisableable: true,
      },
      select: { id: true },
    });
    expect(result).toEqual({ notificationId: 'ntf-1' });
  });
});
