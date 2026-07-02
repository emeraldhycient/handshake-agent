/**
 * Prisma adapter for IBroadcastDispatchRepository (admin Comms broadcast send,
 * Phase 7). Infrastructure layer only — the only place in this feature that imports
 * the generated Prisma client / PrismaService (dependency-cruiser rule §3.2). Maps
 * an audience cohort to recipients and ENQUEUES the broadcast into the notifications
 * outbox (one `Notification` per recipient); the deterministic dispatch worker then
 * drains it. Moves no money (§3.1).
 *
 * COHORT RESOLUTION (against real columns only — never fabricated):
 *   all      → active, non-deleted users
 *   verified → kycStatus = verified
 *   tier_1   → kycTier = tier_1
 *   lagos    → (no geo column in the schema yet) resolves to the verified set as a
 *              documented approximation — a shape gap until a location field exists.
 *
 * IDEMPOTENCY: each recipient row's `eventRef` is `broadcast:<broadcastId>:<userId>`,
 * unique on the outbox's `(eventRef, eventType)`. `createMany({ skipDuplicates })`
 * therefore makes a replayed request (or an approved maker-checker re-run) a no-op
 * for already-enqueued recipients — never a double-blast.
 */

import { Injectable } from '@nestjs/common';

import type { BroadcastAudience } from '@handshake-agent/contracts';

import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  EnqueueBroadcastInput,
  EnqueueBroadcastResult,
  IBroadcastDispatchRepository,
} from '../application/ports/broadcast-dispatch.repository.port';

/** The `Prisma.UserWhereInput` fragment (structural — no client type imported). */
type UserWhere = Record<string, unknown>;

/** How many recipient rows we insert per DB round-trip (keeps a big blast bounded). */
const INSERT_CHUNK = 1000;

@Injectable()
export class BroadcastDispatchPrismaRepository implements IBroadcastDispatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countAudience(audience: BroadcastAudience): Promise<number> {
    return this.prisma.user.count({ where: cohortWhere(audience) });
  }

  async enqueueBroadcast(
    input: EnqueueBroadcastInput,
  ): Promise<EnqueueBroadcastResult> {
    // Resolve recipient ids for the cohort (id-only — no PII leaves the DB, §3.4).
    const recipients = await this.prisma.user.findMany({
      where: cohortWhere(input.audience),
      select: { id: true },
    });

    const templateVars = input.templateVars as Prisma.InputJsonValue;
    let enqueuedCount = 0;

    for (let i = 0; i < recipients.length; i += INSERT_CHUNK) {
      const chunk = recipients.slice(i, i + INSERT_CHUNK);
      const result = await this.prisma.notification.createMany({
        data: chunk.map((r) => ({
          userId: r.id,
          eventType: 'broadcast',
          // Deterministic per-recipient ref → the outbox unique makes re-enqueue a no-op.
          eventRef: `broadcast:${input.broadcastId}:${r.id}`,
          templateKey: input.templateKey,
          templateVars,
          // Marketing/comms broadcast — user preferences may suppress it (NTF-09).
          isDisableable: true,
          expiresAt: input.sendAt !== null ? new Date(input.sendAt) : null,
        })),
        skipDuplicates: true,
      });
      enqueuedCount += result.count;
    }

    return { recipientCount: recipients.length, enqueuedCount };
  }
}

/**
 * The Prisma `where` for a cohort — real columns only, always scoped to
 * active/non-deleted users so a broadcast never targets suspended/deleted accounts.
 */
function cohortWhere(audience: BroadcastAudience): UserWhere {
  const base: UserWhere = { status: 'active', deletedAt: null };
  switch (audience) {
    case 'all':
      return base;
    case 'verified':
      return { ...base, kycStatus: 'verified' };
    case 'tier_1':
      return { ...base, kycTier: 'tier_1' };
    case 'lagos':
      // No geo column yet — approximate with the verified set (documented shape gap).
      return { ...base, kycStatus: 'verified' };
  }
}
