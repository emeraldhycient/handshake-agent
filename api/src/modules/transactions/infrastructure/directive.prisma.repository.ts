/**
 * Prisma adapter for the DirectiveGrant repository port (task 4.2, ADR-0005/0006).
 *
 * The critical operation is `consumeIfIssued`: it must be atomic (at-most-once)
 * to prevent replay. Prisma 7 does not expose a single UPDATE … RETURNING in a
 * portable way, so we use a `$transaction` that:
 *   1. `updateMany` WHERE directiveId AND status='issued' AND expiresAt>now
 *   2. If count=1: fetch the updated row and return it.
 *   3. If count=0: return null (nothing was updated — not issued / already consumed / expired).
 *
 * This two-step approach is safe because Postgres serializes within a transaction;
 * no concurrent consumer can slip between the update and the follow-up read.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  DirectiveGrantStatus,
  DirectiveOrigin,
  UiComponentRef,
} from '../../../../generated/prisma/client';
import type {
  IDirectiveRepository,
  DirectiveGrantRecord,
  CreateDirectiveGrantData,
  ConsumeIfIssuedInput,
} from '../application/ports/directive.repository.port';

// Re-export so infrastructure tests and callers can hash nonces without
// re-implementing. The canonical implementation lives in core/crypto/hmac.
export { sha256Hex } from '../../../core/crypto/hmac';

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/** Maps a raw Prisma row to the application-level record type. */
function toRecord(row: {
  directiveId: string;
  proposalId: string;
  userId: string;
  directiveRef: string;
  origin: string;
  nonceHash: string;
  signatureValue: string;
  status: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedProposalId: string | null;
  failureReason: string | null;
  failureCount: number;
}): DirectiveGrantRecord {
  return {
    directiveId: row.directiveId,
    proposalId: row.proposalId,
    userId: row.userId,
    directiveRef: row.directiveRef,
    origin: row.origin,
    nonceHash: row.nonceHash,
    signatureValue: row.signatureValue,
    status: row.status,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    consumedProposalId: row.consumedProposalId,
    failureReason: row.failureReason,
    failureCount: row.failureCount,
  };
}

const GRANT_SELECT = {
  directiveId: true,
  proposalId: true,
  userId: true,
  directiveRef: true,
  origin: true,
  nonceHash: true,
  signatureValue: true,
  status: true,
  issuedAt: true,
  expiresAt: true,
  consumedAt: true,
  consumedProposalId: true,
  failureReason: true,
  failureCount: true,
} as const;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class DirectivePrismaRepository implements IDirectiveRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateDirectiveGrantData): Promise<void> {
    await this.prisma.directiveGrant.create({
      data: {
        directiveId: data.directiveId,
        proposalId: data.proposalId,
        userId: data.userId,
        directiveRef: data.directiveRef as UiComponentRef,
        origin: data.origin as DirectiveOrigin,
        nonceHash: data.nonceHash,
        signatureValue: data.signatureValue,
        status: DirectiveGrantStatus.issued,
        issuedAt: data.issuedAt,
        expiresAt: data.expiresAt,
      },
    });
  }

  async consumeIfIssued(
    input: ConsumeIfIssuedInput,
  ): Promise<{ grant: DirectiveGrantRecord } | null> {
    const { directiveId, consumedAt, consumedProposalId } = input;

    return this.prisma.$transaction(async (tx) => {
      // Atomic conditional update: issued → consumed WHERE not expired.
      const { count } = await tx.directiveGrant.updateMany({
        where: {
          directiveId,
          status: DirectiveGrantStatus.issued,
          expiresAt: { gt: consumedAt },
        },
        data: {
          status: DirectiveGrantStatus.consumed,
          consumedAt,
          consumedProposalId,
        },
      });

      if (count === 0) {
        return null;
      }

      // Fetch the now-consumed row (count===1 guaranteed by @unique(directiveId)).
      const row = await tx.directiveGrant.findUnique({
        where: { directiveId },
        select: GRANT_SELECT,
      });

      if (row === null) {
        // Extremely unlikely (row was just updated), but return null to be safe.
        return null;
      }

      return { grant: toRecord(row) };
    });
  }

  async findById(directiveId: string): Promise<DirectiveGrantRecord | null> {
    const row = await this.prisma.directiveGrant.findUnique({
      where: { directiveId },
      select: GRANT_SELECT,
    });

    return row === null ? null : toRecord(row);
  }

  async recordFailure(directiveId: string, reason: string): Promise<void> {
    // Increment failureCount; set status=failed only if still in a non-terminal state.
    // We use updateMany to avoid throwing on not-found.
    await this.prisma.directiveGrant.updateMany({
      where: { directiveId },
      data: {
        failureCount: { increment: 1 },
        failureReason: reason,
        // Mark failed only if the grant is not already in a terminal state.
        // We cannot conditionally set status with Prisma updateMany based on current
        // value in a single call, so we always increment failureCount + set reason,
        // and update status only via a raw conditional (use two updateMany calls).
      },
    });

    // Set status=failed only if it is currently in a non-terminal state.
    await this.prisma.directiveGrant.updateMany({
      where: {
        directiveId,
        status: {
          notIn: [
            DirectiveGrantStatus.consumed,
            DirectiveGrantStatus.revoked,
            DirectiveGrantStatus.cancelled,
          ],
        },
      },
      data: { status: DirectiveGrantStatus.failed },
    });
  }
}
