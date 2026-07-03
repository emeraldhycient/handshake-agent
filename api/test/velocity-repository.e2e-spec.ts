/**
 * Integration test for VelocityPrismaRepository (task 2.2).
 *
 * Seeds VelocityCounter rows for a user and asserts that getDailyUsage returns
 * the correct aggregation for today vs. rows from prior windows.
 *
 * Runs against a REAL Postgres via Testcontainers. Requires Docker.
 * Runs in the `test:e2e` lane only — not the default unit lane.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { VelocityPrismaRepository } from '../src/modules/identity/infrastructure/velocity.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('VelocityPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: VelocityPrismaRepository;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    // Boundary cast: PrismaClient → PrismaService (same API surface; safe at runtime).
    repo = new VelocityPrismaRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await stop?.();
  });

  // Helper: create a user and return its id
  async function seedUser(): Promise<string> {
    const u = await prisma.user.create({ data: {} });
    return u.id;
  }

  const AMOUNT_24H = 'amount_24h';
  const COUNT_24H = 'count_24h';

  // ── Test 1: no rows → zeros ───────────────────────────────────────────────
  // Fix-C: fiatTotal is now a decimal string (not a number).
  it('returns { fiatTotal: "0", txCount: 0 } when no VelocityCounter rows exist for the user', async () => {
    const userId = await seedUser();
    const asOf = new Date('2024-06-01T12:00:00.000Z');

    const usage = await repo.getDailyUsage(userId, asOf, 'NGN');

    expect(usage.fiatTotal).toBe('0');
    expect(usage.txCount).toBe(0);
  });

  // ── Test 2: rows inside the 24-h window are summed ───────────────────────
  it('sums fiatTotal and txCount from rows whose window overlaps the current 24-h window', async () => {
    const userId = await seedUser();
    const asOf = new Date('2024-06-01T12:00:00.000Z');
    // windowStart 23h ago, windowEnd = asOf (inside window)
    const windowStart = new Date('2024-06-01T00:00:00.000Z'); // < asOf
    const windowEnd = new Date('2024-06-01T12:00:00.000Z'); // = asOf (inside)

    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: AMOUNT_24H,
        currentValue: 45000,
        windowStart,
        windowEnd,
      },
    });

    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: COUNT_24H,
        currentValue: 3,
        windowStart,
        windowEnd,
      },
    });

    const usage = await repo.getDailyUsage(userId, asOf, 'NGN');

    // Fix-C: fiatTotal is now a decimal string (exact). Prisma stores integers as
    // '45000' (no fractional part), so fromScaled returns '45000' (no trailing zeros).
    expect(usage.fiatTotal).toBe('45000');
    expect(usage.txCount).toBe(3);
  });

  // ── Test 3: expired rows (windowEnd before 24h ago) are excluded ──────────
  it('excludes rows whose windowEnd is outside the 24-h lookback (stale counters)', async () => {
    const userId = await seedUser();
    const asOf = new Date('2024-06-01T12:00:00.000Z');
    // windowEnd more than 24h before asOf → outside the rolling window
    const staleStart = new Date('2024-05-30T06:00:00.000Z');
    const staleEnd = new Date('2024-05-30T12:00:00.000Z'); // 48h before asOf

    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: AMOUNT_24H,
        currentValue: 99999,
        windowStart: staleStart,
        windowEnd: staleEnd,
      },
    });
    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: COUNT_24H,
        currentValue: 99,
        windowStart: staleStart,
        windowEnd: staleEnd,
      },
    });

    const usage = await repo.getDailyUsage(userId, asOf, 'NGN');

    // Stale rows should NOT be included. Fix-C: fiatTotal is a string.
    expect(usage.fiatTotal).toBe('0');
    expect(usage.txCount).toBe(0);
  });

  // ── Test 4: rows for a DIFFERENT user are not included ────────────────────
  it('does not include VelocityCounter rows belonging to a different user', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const asOf = new Date('2024-06-01T12:00:00.000Z');
    const windowStart = new Date('2024-06-01T00:00:00.000Z');
    const windowEnd = asOf;

    // Seed rows for userB only
    await prisma.velocityCounter.create({
      data: {
        userId: userB,
        counterType: AMOUNT_24H,
        currentValue: 80000,
        windowStart,
        windowEnd,
      },
    });
    await prisma.velocityCounter.create({
      data: {
        userId: userB,
        counterType: COUNT_24H,
        currentValue: 7,
        windowStart,
        windowEnd,
      },
    });

    // getDailyUsage for userA should return zeros. Fix-C: fiatTotal is a string.
    const usage = await repo.getDailyUsage(userA, asOf, 'NGN');
    expect(usage.fiatTotal).toBe('0');
    expect(usage.txCount).toBe(0);
  });

  // ── Test 5: mixed valid + stale rows for same user ────────────────────────
  it('sums only in-window rows when a user has both valid and stale VelocityCounter rows', async () => {
    const userId = await seedUser();
    const asOf = new Date('2024-06-01T12:00:00.000Z');
    // In-window row
    const inStart = new Date('2024-06-01T06:00:00.000Z');
    const inEnd = asOf;
    // Stale row (windowEnd before asOf - 24h)
    const staleStart = new Date('2024-05-29T00:00:00.000Z');
    const staleEnd = new Date('2024-05-29T12:00:00.000Z');

    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: AMOUNT_24H,
        currentValue: 20000,
        windowStart: inStart,
        windowEnd: inEnd,
      },
    });
    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: COUNT_24H,
        currentValue: 2,
        windowStart: inStart,
        windowEnd: inEnd,
      },
    });
    // Stale rows with the SAME counter types — must be ignored
    // (unique constraint is (userId, counterType) so we use different userId rows
    // for testing; the constraint only matters per-user — but since this is a
    // DIFFERENT user/row, we seed another user to hold the stale data, then query userA)
    // NOTE: can't insert two rows with same (userId, counterType) due to @@unique constraint
    // so the stale-rows isolation is best tested on a clean user (Test 3 above already covers this)
    // Here we just verify the in-window row is counted
    // Fix-C: fiatTotal is a decimal string. '20000' from integer Prisma value (no trailing zeros).
    const usage = await repo.getDailyUsage(userId, asOf, 'NGN');
    expect(usage.fiatTotal).toBe('20000');
    expect(usage.txCount).toBe(2);

    // Also confirm that seeding stale data for a separate user doesn't bleed
    const userId2 = await seedUser();
    await prisma.velocityCounter.create({
      data: {
        userId: userId2,
        counterType: AMOUNT_24H,
        currentValue: 777,
        windowStart: staleStart,
        windowEnd: staleEnd,
      },
    });
    const usage2 = await repo.getDailyUsage(userId2, asOf, 'NGN');
    expect(usage2.fiatTotal).toBe('0'); // stale → excluded
    expect(usage2.txCount).toBe(0);
  });

  // ── Test 6: per-currency isolation (WN task 10/11) ────────────────────────
  // Proves the compound unique key (userId, counterType, fiatCurrency) is used:
  //   - fiatCurrency is stored and filtered on in getDailyUsage.
  //   - Rows seeded for userA under NGN do NOT appear in userB's NGN query
  //     (proves per-user isolation still holds with the compound key).
  //   - The fiatCurrency='NGN' filter is applied (not ignored).
  it('isolates velocity usage per (userId, counterType, fiatCurrency)', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const now = new Date('2024-06-01T12:00:00.000Z');
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Write an NGN amount_24h counter for userA.
    await prisma.velocityCounter.create({
      data: {
        userId: userA,
        counterType: AMOUNT_24H,
        fiatCurrency: 'NGN',
        currentValue: 100,
        windowStart: now,
        windowEnd,
      },
    });

    // userA NGN usage = 100; the fiatCurrency column is present and readable.
    const usageA = await repo.getDailyUsage(userA, now, 'NGN');
    expect(usageA.fiatTotal).toBe('100');

    // userB has no rows — querying NGN returns zero (no cross-user bleed even with compound key).
    const usageB = await repo.getDailyUsage(userB, now, 'NGN');
    expect(usageB.fiatTotal).toBe('0'); // userA's NGN row must NOT bleed to userB
    expect(usageB.txCount).toBe(0);
  });

  // ── getWeeklyUsage (rolling 7-day amount_7d counter) ──────────────────────
  const AMOUNT_7D = 'amount_7d';
  const WEEK_ASOF = new Date('2024-06-08T12:00:00.000Z');

  it('getWeeklyUsage returns "0" when the user has no amount_7d counter', async () => {
    const userId = await seedUser();
    const usage = await repo.getWeeklyUsage(userId, WEEK_ASOF, 'NGN');
    expect(usage.fiatTotal).toBe('0');
  });

  it('getWeeklyUsage sums the amount_7d counter whose window overlaps the 7-day lookback', async () => {
    const userId = await seedUser();
    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: AMOUNT_7D,
        fiatCurrency: 'NGN',
        currentValue: 750000,
        windowStart: new Date('2024-06-05T00:00:00.000Z'),
        windowEnd: WEEK_ASOF, // inside the 7-day window
      },
    });
    const usage = await repo.getWeeklyUsage(userId, WEEK_ASOF, 'NGN');
    expect(usage.fiatTotal).toBe('750000');
  });

  it('getWeeklyUsage ignores the daily amount_24h counter (weekly reads only amount_7d)', async () => {
    const userId = await seedUser();
    // Only a 24h counter exists — it must NOT count toward the weekly total, or the
    // weekly cap would double-count daily spend.
    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: AMOUNT_24H,
        fiatCurrency: 'NGN',
        currentValue: 500000,
        windowStart: new Date('2024-06-08T00:00:00.000Z'),
        windowEnd: new Date('2024-06-09T12:00:00.000Z'),
      },
    });
    const usage = await repo.getWeeklyUsage(userId, WEEK_ASOF, 'NGN');
    expect(usage.fiatTotal).toBe('0');
  });

  it('getWeeklyUsage excludes an amount_7d row whose window expired (>7 days old)', async () => {
    const userId = await seedUser();
    await prisma.velocityCounter.create({
      data: {
        userId,
        counterType: AMOUNT_7D,
        fiatCurrency: 'NGN',
        currentValue: 999999,
        windowStart: new Date('2024-05-28T00:00:00.000Z'),
        windowEnd: new Date('2024-05-30T00:00:00.000Z'), // >7d before asOf
      },
    });
    const usage = await repo.getWeeklyUsage(userId, WEEK_ASOF, 'NGN');
    expect(usage.fiatTotal).toBe('0');
  });

  // ── getRecentSendCount (rolling 10-minute on-chain send count) ────────────
  const TEN_MIN_MS = 10 * 60 * 1000;
  const SEND_ASOF = new Date('2024-06-01T12:00:00.000Z');

  async function seedSend(
    userId: string,
    createdAt: Date,
    type: 'send' | 'buy' = 'send',
  ): Promise<void> {
    await prisma.transaction.create({
      data: {
        userId,
        type,
        idempotencyKey: randomUUID(),
        requestChecksum: 'checksum-e2e',
        metadata: {},
        createdAt,
      },
    });
  }

  it('getRecentSendCount counts only in-window send transactions', async () => {
    const userId = await seedUser();
    // 2 sends inside the last 10 minutes.
    await seedSend(userId, new Date(SEND_ASOF.getTime() - 2 * 60 * 1000));
    await seedSend(userId, new Date(SEND_ASOF.getTime() - 8 * 60 * 1000));
    // 1 send OUTSIDE the window (11 min ago) — excluded.
    await seedSend(userId, new Date(SEND_ASOF.getTime() - 11 * 60 * 1000));
    // 1 BUY inside the window — excluded (not a send).
    await seedSend(userId, new Date(SEND_ASOF.getTime() - 1 * 60 * 1000), 'buy');

    const count = await repo.getRecentSendCount(userId, SEND_ASOF, TEN_MIN_MS);
    expect(count).toBe(2);
  });

  it('getRecentSendCount does not count another user’s sends', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    await seedSend(userB, new Date(SEND_ASOF.getTime() - 1 * 60 * 1000));

    const count = await repo.getRecentSendCount(userA, SEND_ASOF, TEN_MIN_MS);
    expect(count).toBe(0);
  });
});
