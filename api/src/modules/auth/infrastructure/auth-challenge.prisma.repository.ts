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
    await this.prisma.authChallenge.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, challengeHash, expiresAt },
      update: {
        challengeHash,
        expiresAt,
        attemptCount: 0,
        verifiedAt: null,
        issuedAt: new Date(),
      },
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
