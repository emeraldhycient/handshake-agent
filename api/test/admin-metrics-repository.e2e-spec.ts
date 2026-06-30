/**
 * Integration test for MetricsReadPrismaRepository (Phase 5 — FINAL, READ-ONLY).
 *
 * Seeds Users (varied kycStatus/tier/createdAt), Transactions (varied type/status/
 * createdAt) and their platform-fee LedgerEntry legs against a real Postgres schema
 * (Testcontainers), then asserts every aggregation: transactionVolume (per-type
 * counts + daily series + success rate), revenue (exact fee sum by currency),
 * kycFunnel (status + tier counts), activeUsers (active/new/total), serviceHealth
 * (per-service total/completed/failed + success rate).
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { MetricsReadPrismaRepository } from '../src/modules/admin/infrastructure/metrics-read.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

// The range used by the assertions: all "in range" seeds fall inside this window.
const FROM = new Date('2026-06-01T00:00:00.000Z');
const TO = new Date('2026-06-30T23:59:59.999Z');

describe('MetricsReadPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: MetricsReadPrismaRepository;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    repo = new MetricsReadPrismaRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await stop?.();
  });

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.kycProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  // ── Seed helpers ───────────────────────────────────────────────────────────

  async function seedUser(over?: {
    kycStatus?: string;
    kycTier?: string;
    createdAt?: Date;
    deletedAt?: Date | null;
  }): Promise<string> {
    const user = await prisma.user.create({
      data: {
        kycStatus: (over?.kycStatus ?? 'not_started') as never,
        kycTier: (over?.kycTier ?? 'unverified') as never,
        ...(over?.createdAt ? { createdAt: over.createdAt } : {}),
        ...(over?.deletedAt ? { deletedAt: over.deletedAt } : {}),
      },
      select: { id: true },
    });
    return user.id;
  }

  async function seedTxn(over: {
    userId: string;
    type: string;
    status: string;
    createdAt: Date;
  }): Promise<string> {
    const txn = await prisma.transaction.create({
      data: {
        userId: over.userId,
        type: over.type as never,
        status: over.status as never,
        idempotencyKey: randomUUID(),
        requestChecksum: `chk-${randomUUID()}`,
        metadata: {},
        createdAt: over.createdAt,
      },
      select: { id: true },
    });
    return txn.id;
  }

  /**
   * Seed a platform-fee credit leg (the fee-revenue leg). `sequence` is the
   * per-(accountType, accountId) monotonic counter — callers pass a distinct value
   * per leg to satisfy the @@unique([accountType, accountId, sequence]) constraint.
   */
  async function seedFeeLeg(
    txnId: string,
    over: {
      accountId: string;
      currency: string;
      amount: string;
      postedAt: Date;
      sequence: number;
    },
  ): Promise<void> {
    await prisma.ledgerEntry.create({
      data: {
        transactionId: txnId,
        accountType: 'platform_float' as never,
        accountId: over.accountId,
        currency: over.currency,
        amount: over.amount,
        direction: 'credit' as never,
        description: 'fee revenue',
        balanceAfter: over.amount,
        sequence: over.sequence,
        postedAt: over.postedAt,
      },
    });
  }

  // ── transactionVolume ──────────────────────────────────────────────────────

  describe('transactionVolume', () => {
    it('groups by type with completed/failed counts, a daily series, and success rate', async () => {
      const u = await seedUser();
      // 2 buys completed (one on 06-01, one on 06-02), 1 buy failed (06-01).
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-01T08:00:00.000Z'),
      });
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-02T08:00:00.000Z'),
      });
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'failed',
        createdAt: new Date('2026-06-01T09:00:00.000Z'),
      });
      // 1 send completed (06-02).
      await seedTxn({
        userId: u,
        type: 'send',
        status: 'completed',
        createdAt: new Date('2026-06-02T10:00:00.000Z'),
      });
      // Out-of-range txn — must be excluded.
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-05-15T08:00:00.000Z'),
      });

      const result = await repo.transactionVolume(FROM, TO);

      const buy = result.byType.find((t) => t.type === 'buy')!;
      expect(buy.count).toBe(3);
      expect(buy.completed).toBe(2);
      expect(buy.failed).toBe(1);
      const send = result.byType.find((t) => t.type === 'send')!;
      expect(send.count).toBe(1);
      expect(send.completed).toBe(1);
      expect(send.failed).toBe(0);

      // Daily series: 06-01 has 2 (buy completed + buy failed), 06-02 has 2.
      const d1 = result.series.find((b) => b.date === '2026-06-01')!;
      const d2 = result.series.find((b) => b.date === '2026-06-02')!;
      expect(d1.count).toBe(2);
      expect(d2.count).toBe(2);
      // No out-of-range date.
      expect(result.series.some((b) => b.date === '2026-05-15')).toBe(false);

      // successRate = completed (3) / (completed 3 + failed 1) = 0.75.
      expect(result.successRate).toBeCloseTo(0.75, 6);
    });

    it('returns successRate 0 when there are no completed/failed txns in range', async () => {
      const result = await repo.transactionVolume(FROM, TO);
      expect(result.byType).toEqual([]);
      expect(result.series).toEqual([]);
      expect(result.successRate).toBe(0);
    });
  });

  // ── revenue ────────────────────────────────────────────────────────────────

  describe('revenue', () => {
    it('sums platform-fee legs of COMPLETED txns by currency, exact, and reports spread []', async () => {
      const u = await seedUser();
      const t1 = await seedTxn({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-01T08:00:00.000Z'),
      });
      const t2 = await seedTxn({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-02T08:00:00.000Z'),
      });
      // A failed txn whose fee leg must NOT count toward revenue.
      const t3 = await seedTxn({
        userId: u,
        type: 'buy',
        status: 'failed',
        createdAt: new Date('2026-06-03T08:00:00.000Z'),
      });
      // Out-of-range completed txn — excluded.
      const t4 = await seedTxn({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-05-01T08:00:00.000Z'),
      });

      await seedFeeLeg(t1, {
        accountId: 'ngn_fees',
        currency: 'NGN',
        amount: '100.5',
        postedAt: new Date('2026-06-01T08:00:00.000Z'),
        sequence: 1,
      });
      await seedFeeLeg(t2, {
        accountId: 'ngn_fees',
        currency: 'NGN',
        amount: '49.5',
        postedAt: new Date('2026-06-02T08:00:00.000Z'),
        sequence: 2,
      });
      await seedFeeLeg(t3, {
        accountId: 'ngn_fees',
        currency: 'NGN',
        amount: '999',
        postedAt: new Date('2026-06-03T08:00:00.000Z'),
        sequence: 3,
      });
      await seedFeeLeg(t4, {
        accountId: 'ngn_fees',
        currency: 'NGN',
        amount: '777',
        postedAt: new Date('2026-05-01T08:00:00.000Z'),
        sequence: 4,
      });

      const result = await repo.revenue(FROM, TO);

      // 100.5 + 49.5 = 150 (exact; t3 failed + t4 out-of-range excluded).
      const ngn = result.totalFeesByCurrency.find((c) => c.currency === 'NGN')!;
      expect(ngn.amount).toBe('150');
      expect(result.totalSpreadByCurrency).toEqual([]);
      // txnCount = completed txns in range (t1, t2) = 2.
      expect(result.txnCount).toBe(2);
    });

    it('returns empty fees and txnCount 0 when no completed txns in range', async () => {
      const result = await repo.revenue(FROM, TO);
      expect(result.totalFeesByCurrency).toEqual([]);
      expect(result.totalSpreadByCurrency).toEqual([]);
      expect(result.txnCount).toBe(0);
    });
  });

  // ── kycFunnel ──────────────────────────────────────────────────────────────

  describe('kycFunnel', () => {
    it('counts users by kycStatus and kycTier, excluding soft-deleted', async () => {
      await seedUser({ kycStatus: 'verified', kycTier: 'tier_1' });
      await seedUser({ kycStatus: 'verified', kycTier: 'tier_2' });
      await seedUser({ kycStatus: 'pending', kycTier: 'unverified' });
      // Soft-deleted — must be excluded from both groupings.
      await seedUser({
        kycStatus: 'verified',
        kycTier: 'tier_3',
        deletedAt: new Date('2026-06-10T00:00:00.000Z'),
      });

      const result = await repo.kycFunnel();

      const verified = result.byStatus.find((s) => s.key === 'verified')!;
      expect(verified.count).toBe(2);
      const pending = result.byStatus.find((s) => s.key === 'pending')!;
      expect(pending.count).toBe(1);

      const tier1 = result.byTier.find((t) => t.key === 'tier_1')!;
      expect(tier1.count).toBe(1);
      const tier2 = result.byTier.find((t) => t.key === 'tier_2')!;
      expect(tier2.count).toBe(1);
      // tier_3 belonged only to the soft-deleted user → absent.
      expect(result.byTier.some((t) => t.key === 'tier_3')).toBe(false);
    });
  });

  // ── activeUsers ────────────────────────────────────────────────────────────

  describe('activeUsers', () => {
    it('counts distinct active (transacted in range), new (created in range), and total users', async () => {
      // u1 created in range + transacts twice in range → active + new.
      const u1 = await seedUser({
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
      });
      // u2 created BEFORE range + transacts in range → active, not new.
      const u2 = await seedUser({
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      });
      // u3 created in range, no transaction → new, not active.
      await seedUser({ createdAt: new Date('2026-06-20T00:00:00.000Z') });
      // u4 soft-deleted → excluded from total.
      await seedUser({
        createdAt: new Date('2026-06-21T00:00:00.000Z'),
        deletedAt: new Date('2026-06-22T00:00:00.000Z'),
      });

      await seedTxn({
        userId: u1,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-06T00:00:00.000Z'),
      });
      await seedTxn({
        userId: u1,
        type: 'sell',
        status: 'completed',
        createdAt: new Date('2026-06-07T00:00:00.000Z'),
      });
      await seedTxn({
        userId: u2,
        type: 'send',
        status: 'completed',
        createdAt: new Date('2026-06-08T00:00:00.000Z'),
      });
      // Out-of-range txn for u2 — does not add a second distinct active user.
      await seedTxn({
        userId: u2,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-05-02T00:00:00.000Z'),
      });

      const result = await repo.activeUsers(FROM, TO);

      // Distinct active users: u1, u2 = 2.
      expect(result.activeInRange).toBe(2);
      // New users (created in range, not soft-deleted): u1, u3 = 2.
      expect(result.newInRange).toBe(2);
      // Total non-soft-deleted users: u1, u2, u3 = 3.
      expect(result.totalUsers).toBe(3);
    });
  });

  // ── serviceHealth ──────────────────────────────────────────────────────────

  describe('serviceHealth', () => {
    it('reports per-service total/completed/failed + success rate for buy/sell/send/swap', async () => {
      const u = await seedUser();
      // buy: 2 completed, 1 failed → total 3, rate 2/3.
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      });
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
      });
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'failed',
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
      });
      // swap: 1 completed → rate 1.
      await seedTxn({
        userId: u,
        type: 'swap',
        status: 'completed',
        createdAt: new Date('2026-06-04T00:00:00.000Z'),
      });

      const result = await repo.serviceHealth(FROM, TO);
      const services = Object.fromEntries(
        result.services.map((s) => [s.service, s]),
      );

      // Every transactable service appears, even when it has no txns.
      expect(Object.keys(services).sort()).toEqual([
        'buy',
        'sell',
        'send',
        'swap',
      ]);

      expect(services.buy.total).toBe(3);
      expect(services.buy.completed).toBe(2);
      expect(services.buy.failed).toBe(1);
      expect(services.buy.successRate).toBeCloseTo(2 / 3, 6);

      expect(services.swap.total).toBe(1);
      expect(services.swap.successRate).toBe(1);

      // sell/send have no txns → zeros, successRate 0.
      expect(services.sell.total).toBe(0);
      expect(services.sell.successRate).toBe(0);
      expect(services.send.total).toBe(0);
    });
  });
});
