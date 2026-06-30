import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  AuthChallengeType,
  IAuthChallengeRepository,
} from '../application/ports/auth-challenge.repository.port';

@Injectable()
export class AuthChallengePrismaRepository implements IAuthChallengeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: {
    userId: string;
    type: AuthChallengeType;
    challengeHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const { userId, type, challengeHash, expiresAt } = input;
    const now = new Date();
    const issuedAt = now;

    // attemptCount carry-over policy (security invariant — see the port doc):
    // - email_verification: always reset to 0 on re-issue (opaque, low abuse).
    // - otp_email: preserve the counter ONLY while the prior window is still
    //   ACTIVE (unexpired AND unconsumed). Preserving it across an expired or
    //   consumed window would let an attacker exhaust the guess budget once and
    //   permanently lock out any known email (C2). Re-issuing after expiry or
    //   consumption — or when no prior row exists — starts a clean window at 0.
    // Read + upsert run in one transaction so the active-window decision and the
    // write cannot interleave with a concurrent re-issue for the same key.
    await this.prisma.$transaction(async (tx) => {
      let preserveAttemptCount = false;
      if (type === 'otp_email') {
        const prior = await tx.authChallenge.findUnique({
          where: { userId_type: { userId, type } },
          select: { expiresAt: true, verifiedAt: true },
        });
        preserveAttemptCount =
          prior !== null && prior.verifiedAt === null && prior.expiresAt > now;
      }

      const update = preserveAttemptCount
        ? { challengeHash, expiresAt, verifiedAt: null, issuedAt }
        : {
            challengeHash,
            expiresAt,
            attemptCount: 0,
            verifiedAt: null,
            issuedAt,
          };

      await tx.authChallenge.upsert({
        where: { userId_type: { userId, type } },
        create: { userId, type, challengeHash, expiresAt },
        update,
      });
    });
  }

  async findActiveByHashAndType(
    challengeHash: string,
    type: AuthChallengeType,
    now: Date,
  ): Promise<{ id: string; userId: string } | null> {
    const row = await this.prisma.authChallenge.findFirst({
      where: { challengeHash, type, verifiedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true },
    });
    return row ?? null;
  }

  async findActiveByUserAndType(
    userId: string,
    type: AuthChallengeType,
    now: Date,
  ): Promise<{
    id: string;
    challengeHash: string;
    attemptCount: number;
  } | null> {
    const row = await this.prisma.authChallenge.findFirst({
      where: { userId, type, verifiedAt: null, expiresAt: { gt: now } },
      select: { id: true, challengeHash: true, attemptCount: true },
    });
    return row ?? null;
  }

  async incrementAttempt(id: string): Promise<void> {
    await this.prisma.authChallenge.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  }

  async consume(id: string, now: Date): Promise<void> {
    await this.prisma.authChallenge.update({
      where: { id },
      data: { verifiedAt: now },
    });
  }
}
