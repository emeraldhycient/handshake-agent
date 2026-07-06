import { Injectable } from '@nestjs/common';

// The generated Prisma client is the ONLY sanctioned DB door (CLAUDE.md §3.2).
// This is the infrastructure layer — the only place it is allowed.
import { PrismaService } from '../../../core/prisma/prisma.service';
// VelocityCounterType and FiatCurrency are re-exported from the main client entry point (which also
// re-exports all enums via `export * from "./enums"`). Import from client.ts so
// the module resolver resolves the same path used everywhere else in infrastructure.
import {
  FiatCurrency,
  TransactionType,
  VelocityCounterType,
} from '../../../../generated/prisma/client';
// Fix-C: reuse the ledger's toScaled for exact-decimal string accumulation so
// the velocity repo and the gate use the same arithmetic domain.
import { toScaled } from '../../transactions/domain/ledger';
import type {
  DailyUsage,
  IVelocityRepository,
  WeeklyUsage,
} from '../application/ports/velocity.repository.port';

/**
 * Prisma adapter for the velocity repository port.
 *
 * Reads VelocityCounter rows to produce the current fixed-window usage.
 * The model has one row per (userId, counterType, fiatCurrency); we read the
 * `amount_24h` row for fiat total and the `count_24h` row for transaction count.
 *
 * The write path anchors each counter to a FIXED window `[windowStart, windowEnd)`
 * where `windowEnd = windowStart + windowMs`, and resets the counter (fresh window,
 * value = delta) only when a new transaction arrives at/after `windowEnd`. The read
 * must therefore treat the window as CLOSED once `asOf` reaches `windowEnd`: a row
 * is active iff `windowStart <= asOf < windowEnd`. Reading `windowEnd > asOf - 24h`
 * instead would keep an expired counter alive for an extra window (limits appear to
 * reset after 48h, not 24h) and a capped user could never self-reset.
 *
 * Dependency rule: infrastructure → core (PrismaService). Application imports
 * NOTHING from here (dependency-cruiser enforces the inward-only rule).
 */
@Injectable()
export class VelocityPrismaRepository implements IVelocityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyUsage(
    userId: string,
    asOf: Date,
    fiatCurrency: string,
  ): Promise<DailyUsage> {
    // Cast string → generated FiatCurrency enum at the infrastructure boundary
    // (port uses `string` to keep application layer free of Prisma imports — §3.2).
    const fiatCurrencyEnum = fiatCurrency as FiatCurrency;

    const rows = await this.prisma.velocityCounter.findMany({
      where: {
        userId,
        // WN task 10/11: per-currency isolation — only rows for the given currency.
        fiatCurrency: fiatCurrencyEnum,
        counterType: {
          in: [VelocityCounterType.amount_24h, VelocityCounterType.count_24h],
        },
        // Fixed window is active only while asOf is strictly before its end.
        // Once asOf >= windowEnd the window has closed → usage resets to zero.
        windowEnd: { gt: asOf },
        // Window must have started at or before asOf (guards future-dated rows).
        windowStart: { lte: asOf },
      },
      select: {
        counterType: true,
        currentValue: true,
      },
    });

    // Fix-C: accumulate fiatTotal using BigInt-scaled arithmetic (toScaled from the
    // ledger domain, 10^18 scale) so the velocity repo uses exactly the same scale
    // as the KycGateService comparisons. No Number() on the fiat path.
    // count_24h is always an integer so Number() remains safe there.
    const SCALE = 10n ** 18n;
    let fiatScaled = 0n;
    let txCount = 0;

    for (const row of rows) {
      if (row.counterType === VelocityCounterType.amount_24h) {
        // Prisma Decimal.toString() is the exact decimal string; feed directly to toScaled.
        const rowStr = (row.currentValue as { toString(): string }).toString();
        fiatScaled += toScaled(rowStr);
      } else if (row.counterType === VelocityCounterType.count_24h) {
        txCount += Number(row.currentValue);
      }
    }

    // Convert scaled bigint back to decimal string (mirrors fromScaled in ledger.ts).
    // This string is what KycGateService.assertCanTransact feeds to toScaled() for
    // the dailyFiat comparison — same scale, so no precision is lost in the round-trip.
    return { fiatTotal: scaledToDecimalString(fiatScaled, SCALE), txCount };
  }

  /**
   * Current 7-day fiat total for the weekly cap. Reads the `amount_7d` VelocityCounter
   * whose fixed window is still active (`windowStart <= asOf < windowEnd`), scoped to
   * `fiatCurrency`. Amount only — the weekly cap is a spend cap, there is no weekly count
   * cap. Same exact-decimal (BigInt-scaled) round-trip as getDailyUsage so the gate
   * compares in one scale.
   */
  async getWeeklyUsage(
    userId: string,
    asOf: Date,
    fiatCurrency: string,
  ): Promise<WeeklyUsage> {
    const fiatCurrencyEnum = fiatCurrency as FiatCurrency;

    const rows = await this.prisma.velocityCounter.findMany({
      where: {
        userId,
        fiatCurrency: fiatCurrencyEnum,
        counterType: VelocityCounterType.amount_7d,
        // Fixed 7-day window: active only while asOf < windowEnd (closes at windowEnd).
        windowEnd: { gt: asOf },
        windowStart: { lte: asOf },
      },
      select: { currentValue: true },
    });

    const SCALE = 10n ** 18n;
    let fiatScaled = 0n;
    for (const row of rows) {
      const rowStr = (row.currentValue as { toString(): string }).toString();
      fiatScaled += toScaled(rowStr);
    }

    return { fiatTotal: scaledToDecimalString(fiatScaled, SCALE) };
  }

  /**
   * Count on-chain (crypto-address) SEND transactions this user created in the last
   * `windowMs` (the rolling-10-minute rapid-fire cap). Counts actual `send`-type
   * Transaction rows regardless of status — a burst of attempts is the risk — so there
   * is no dedicated counter to maintain/reverse.
   */
  async getRecentSendCount(
    userId: string,
    asOf: Date,
    windowMs: number,
  ): Promise<number> {
    const since = new Date(asOf.getTime() - windowMs);
    return this.prisma.transaction.count({
      where: {
        userId,
        type: TransactionType.send,
        createdAt: { gt: since, lte: asOf },
      },
    });
  }
}

/**
 * Convert a BigInt-scaled fiat value (10^18 scale) back to its exact decimal string —
 * the inverse of the ledger's toScaled(), matching fromScaled()'s formatting so the
 * gate re-scales it losslessly.
 */
function scaledToDecimalString(scaled: bigint, scale: bigint): string {
  const isNeg = scaled < 0n;
  const abs = isNeg ? -scaled : scaled;
  const whole = abs / scale;
  const frac = abs % scale;
  return frac === 0n
    ? (isNeg ? '-' : '') + whole.toString()
    : (isNeg ? '-' : '') +
        whole.toString() +
        '.' +
        frac.toString().padStart(18, '0').replace(/0+$/, '');
}
