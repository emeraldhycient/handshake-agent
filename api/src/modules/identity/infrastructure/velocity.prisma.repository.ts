import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  DailyUsage,
  IVelocityRepository,
} from '../application/ports/velocity.repository.port';

/**
 * Prisma adapter for the velocity repository port.
 *
 * Reads VelocityCounter rows to produce the rolling 24-h usage aggregation.
 * The model has one row per (userId, counterType); we read the `amount_24h` row
 * for fiat total and the `count_24h` row for transaction count, filtering by
 * whether the row's window overlaps the 24-h period ending at `asOf`.
 *
 * A row is "in window" when its windowEnd > (asOf - 24h), meaning the counter
 * was updated within the last 24 hours from the caller's perspective. Rows whose
 * windowEnd is before that cutoff are stale (prior day's counter) and excluded.
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 */
@Injectable()
export class VelocityPrismaRepository implements IVelocityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyUsage(userId: string, asOf: Date): Promise<DailyUsage> {
    const windowCutoff = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);

    const rows = await this.prisma.velocityCounter.findMany({
      where: {
        userId,
        counterType: { in: ['amount_24h', 'count_24h'] },
        // Row's window must still be active: windowEnd > (asOf - 24h)
        windowEnd: { gt: windowCutoff },
        // Window must have started at or before asOf
        windowStart: { lte: asOf },
      },
      select: {
        counterType: true,
        currentValue: true,
      },
    });

    let fiatTotal = 0;
    let txCount = 0;

    for (const row of rows) {
      // currentValue is a Prisma Decimal — convert to number for application use.
      const value = Number(row.currentValue);
      if (row.counterType === 'amount_24h') {
        fiatTotal += value;
      } else if (row.counterType === 'count_24h') {
        txCount += value;
      }
    }

    return { fiatTotal, txCount };
  }
}
