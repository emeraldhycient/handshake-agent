import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  ActiveUserPage,
  IUserLister,
} from '../../wallets/application/ports/user-lister.port';

/**
 * Prisma adapter for IUserLister (WN-5).
 *
 * Owned by identity/infrastructure because it queries the User table —
 * the only layer allowed to import PrismaService (CLAUDE.md §3.2).
 *
 * Registered in WalletsModule as the USER_LISTER provider via the
 * IdentityModule export — this keeps the cross-feature wiring at the
 * composition (module) layer, not inside application services (dep-cruiser
 * permits it; the forbidden rule is application→infrastructure, not
 * module-wiring via exports).
 *
 * Cursor strategy: keyset on `id` (UUID v4 — lexicographically ordered).
 * No OFFSET so the scan stays O(n) over very large tables without drift.
 *
 * "Active" definition: status = 'active' (mirrors the check in IdentityService
 * and the KYC gate). Users in other states (suspended, pending) are skipped —
 * they cannot transact and do not need a wallet backfill.
 */
@Injectable()
export class ActiveUserListerPrismaAdapter implements IUserLister {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveUserIds(input: {
    cursor: string | null;
    limit: number;
  }): Promise<ActiveUserPage> {
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'active',
        // Keyset cursor: fetch ids strictly greater than the last seen id.
        ...(input.cursor !== null ? { id: { gt: input.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: input.limit,
      select: { id: true },
    });

    const ids = rows.map((r) => r.id);
    // nextCursor is the last id on this page; null when we got fewer than limit.
    const nextCursor =
      ids.length === input.limit ? (ids[ids.length - 1] ?? null) : null;

    return { ids, nextCursor };
  }
}
