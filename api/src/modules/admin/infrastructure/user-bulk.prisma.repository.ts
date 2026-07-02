/**
 * Prisma adapter for IUserBulkRepository (admin Users bulk bar, Phase 7).
 * Infrastructure layer only — the only place in this feature that imports the
 * generated Prisma client / PrismaService (dependency-cruiser rule §3.2). Backs the
 * two bulk actions over an EXPLICIT selected set of end-user ids. Moves no money
 * (§3.1): a tag is a pure annotation; a message enqueues onto the notifications
 * outbox (the deterministic dispatch worker drains it) — never a direct send.
 *
 * IDEMPOTENCY:
 *   - tags on the (userId, tag) unique — `createMany({ skipDuplicates })` counts
 *     only NEW rows, so re-applying a tag is a no-op;
 *   - messages on the outbox `(eventRef, eventType)` unique via a per-recipient
 *     `eventRef` = `bulk:<broadcastRef>:<userId>` — a replay never double-blasts.
 *
 * The recipient set is always narrowed to ACTIVE, non-deleted users so a bulk op
 * never targets a suspended/deleted account.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  EnqueueMessageInput,
  IUserBulkRepository,
} from '../application/ports/user-bulk.repository.port';

/** How many rows we insert per DB round-trip (keeps a big selection bounded). */
const INSERT_CHUNK = 1000;

@Injectable()
export class UserBulkPrismaRepository implements IUserBulkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async filterExistingUserIds(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: userIds }, status: 'active', deletedAt: null },
      select: { id: true },
    });
    // Preserve the caller's order for a stable, deterministic result.
    const found = new Set(rows.map((r) => r.id));
    return userIds.filter((id) => found.has(id));
  }

  async applyTag(
    userIds: string[],
    tag: string,
    adminId: string,
  ): Promise<{ created: number }> {
    let created = 0;
    for (let i = 0; i < userIds.length; i += INSERT_CHUNK) {
      const chunk = userIds.slice(i, i + INSERT_CHUNK);
      const result = await this.prisma.userTag.createMany({
        data: chunk.map((userId) => ({
          userId,
          tag,
          appliedByAdminId: adminId,
        })),
        // Idempotent on (userId, tag) — an already-tagged user is skipped.
        skipDuplicates: true,
      });
      created += result.count;
    }
    return { created };
  }

  async enqueueMessage(
    input: EnqueueMessageInput,
  ): Promise<{ enqueued: number }> {
    const templateVars = input.templateVars as Prisma.InputJsonValue;
    let enqueued = 0;
    for (let i = 0; i < input.userIds.length; i += INSERT_CHUNK) {
      const chunk = input.userIds.slice(i, i + INSERT_CHUNK);
      const result = await this.prisma.notification.createMany({
        data: chunk.map((userId) => ({
          userId,
          eventType: input.eventType,
          // Deterministic per-recipient ref → the outbox unique makes re-enqueue a no-op.
          eventRef: `bulk:${input.broadcastRef}:${userId}`,
          templateKey: input.templateKey,
          templateVars,
          // Operator-initiated comms — user preferences may suppress it (NTF-09).
          isDisableable: true,
        })),
        skipDuplicates: true,
      });
      enqueued += result.count;
    }
    return { enqueued };
  }
}
