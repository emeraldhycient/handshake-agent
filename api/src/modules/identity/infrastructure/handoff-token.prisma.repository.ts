/**
 * Prisma adapter for IHandoffTokenRepository (K3 — CHN-04).
 *
 * Only infrastructure imports the generated Prisma client (CLAUDE.md §3.2).
 * The application layer is DB-agnostic and depends only on the port interface.
 *
 * Security properties implemented here:
 *   - `findAndConsume`: single $transaction for atomic consume + sibling revoke.
 *   - Only the tokenHash is stored; the raw token is NEVER in this file.
 */

import { Injectable } from '@nestjs/common';

import {
  HandoffPurpose,
  HandoffTokenStatus,
} from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateHandoffTokenInput,
  HandoffTokenRecord,
  IHandoffTokenRepository,
} from '../application/ports/handoff-token.repository.port';

@Injectable()
export class HandoffTokenPrismaRepository implements IHandoffTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateHandoffTokenInput): Promise<HandoffTokenRecord> {
    const row = await this.prisma.handoffToken.create({
      data: {
        tokenHash: input.tokenHash,
        userId: input.userId ?? null,
        channelAddress: input.channelAddress ?? null,
        conversationId: input.conversationId ?? null,
        purpose: input.purpose as HandoffPurpose,
        status: HandoffTokenStatus.issued,
        expiresAt: input.expiresAt,
      },
    });

    return this.toRecord(row);
  }

  async findAndConsume(params: {
    tokenHash: string;
    purpose: string;
    now: Date;
  }): Promise<HandoffTokenRecord | null> {
    const { tokenHash, purpose, now } = params;

    return this.prisma.$transaction(async (tx) => {
      // Find the token — must be issued, not expired, correct purpose.
      const row = await tx.handoffToken.findFirst({
        where: {
          tokenHash,
          purpose: purpose as HandoffPurpose,
          status: HandoffTokenStatus.issued,
          expiresAt: { gt: now },
        },
      });

      if (row === null) {
        return null;
      }

      // Mark THIS token as redeemed.
      await tx.handoffToken.update({
        where: { id: row.id },
        data: {
          status: HandoffTokenStatus.redeemed,
          redeemedAt: now,
        },
      });

      // Sibling-token invalidation: revoke all OTHER issued tokens for the same
      // channelAddress + purpose (not this one, which is already redeemed).
      // Use channelAddress as the binding key since userId can be null (pre-KYC).
      if (row.channelAddress !== null) {
        await tx.handoffToken.updateMany({
          where: {
            channelAddress: row.channelAddress,
            purpose: purpose as HandoffPurpose,
            status: HandoffTokenStatus.issued,
            id: { not: row.id },
          },
          data: {
            status: HandoffTokenStatus.revoked,
          },
        });
      } else if (row.userId !== null) {
        // Fallback: revoke by userId if channelAddress is absent (shouldn't happen in KYC flow).
        await tx.handoffToken.updateMany({
          where: {
            userId: row.userId,
            purpose: purpose as HandoffPurpose,
            status: HandoffTokenStatus.issued,
            id: { not: row.id },
          },
          data: {
            status: HandoffTokenStatus.revoked,
          },
        });
      }

      return this.toRecord(row);
    });
  }

  async findActiveForChannel(params: {
    channelAddress: string;
    purpose: string;
    now: Date;
  }): Promise<HandoffTokenRecord[]> {
    const rows = await this.prisma.handoffToken.findMany({
      where: {
        channelAddress: params.channelAddress,
        purpose: params.purpose as HandoffPurpose,
        status: HandoffTokenStatus.issued,
        expiresAt: { gt: params.now },
      },
    });

    return rows.map((r) => this.toRecord(r));
  }

  // ---------------------------------------------------------------------------
  // Private mapper
  // ---------------------------------------------------------------------------

  private toRecord(row: {
    id: string;
    tokenHash: string;
    userId: string | null;
    channelAddress: string | null;
    conversationId: string | null;
    purpose: string;
    status: string;
    issuedAt: Date;
    createdAt: Date;
    expiresAt: Date;
    redeemedAt: Date | null;
  }): HandoffTokenRecord {
    return {
      id: row.id,
      tokenHash: row.tokenHash,
      userId: row.userId,
      channelAddress: row.channelAddress,
      conversationId: row.conversationId,
      purpose: row.purpose,
      status: row.status,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      redeemedAt: row.redeemedAt,
    };
  }
}
