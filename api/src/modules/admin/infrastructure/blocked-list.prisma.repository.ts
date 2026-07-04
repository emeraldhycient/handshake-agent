import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  type BlockedEntryRecord,
  type CreateBlockedEntryInput,
  type IBlockedListRepository,
} from '../application/ports/blocked-list.repository.port';

/** The persisted row shape this repo reads back from Prisma (before mapping). */
interface BlockedEntryRow {
  id: string;
  kind: BlockedEntryRecord['kind'];
  value: string;
  reason: string;
  addedByAdminId: string;
  createdAt: Date;
  supersededAt: Date | null;
}

/**
 * Prisma-backed APPEND-ONLY deny-list repository (ADM Phase 9). Backs the
 * `blocked_entries` table. `listActive` returns only not-yet-lifted rows
 * (newest-first); `supersede` stamps `supersededAt`/`supersededByAdminId` via an
 * `updateMany` SCOPED to `supersededAt: null` so an already-lifted (or unknown) row
 * is never re-stamped — it returns `count: 0` and this repo answers `null`
 * (the service maps that to a fail-closed 404). Nothing is ever DELETEd. Only this
 * infrastructure repository imports the generated client via PrismaService (§3.2 / §4).
 */
@Injectable()
export class BlockedListPrismaRepository implements IBlockedListRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<BlockedEntryRecord[]> {
    const rows = (await this.prisma.blockedEntry.findMany({
      where: { supersededAt: null },
      orderBy: { createdAt: 'desc' },
    })) as BlockedEntryRow[];
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<BlockedEntryRecord | null> {
    const row = (await this.prisma.blockedEntry.findUnique({
      where: { id },
    })) as BlockedEntryRow | null;
    return row ? toRecord(row) : null;
  }

  async create(input: CreateBlockedEntryInput): Promise<BlockedEntryRecord> {
    const row = (await this.prisma.blockedEntry.create({
      data: {
        kind: input.kind,
        value: input.value,
        reason: input.reason,
        addedByAdminId: input.addedByAdminId,
      },
    })) as BlockedEntryRow;
    return toRecord(row);
  }

  async supersede(
    id: string,
    supersededByAdminId: string,
  ): Promise<BlockedEntryRecord | null> {
    // Scoped to active rows only → an already-lifted (or unknown) id updates 0 rows,
    // so a lift can never be re-applied (idempotent, append-only integrity).
    const { count } = await this.prisma.blockedEntry.updateMany({
      where: { id, supersededAt: null },
      data: { supersededAt: new Date(), supersededByAdminId },
    });
    if (count === 0) return null;
    return this.findById(id);
  }
}

// ── mapper (Prisma row → port record) ─────────────────────────────────────────────

/** Strips the internal `supersededByAdminId` column; the port record exposes only the timestamp. */
function toRecord(row: BlockedEntryRow): BlockedEntryRecord {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    reason: row.reason,
    addedByAdminId: row.addedByAdminId,
    createdAt: row.createdAt,
    supersededAt: row.supersededAt,
  };
}
