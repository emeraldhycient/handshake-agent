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
    // Delete children before parents: ledger/txn → proposal → quote → user
    // (proposals FK userId + quoteId; quotes FK userId).
    await prisma.ledgerEntry.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.proposal.deleteMany();
    await prisma.quote.deleteMany();
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
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const txn = await prisma.transaction.create({
      data: {
        userId: over.userId,
        type: over.type as never,
        status: over.status as never,
        idempotencyKey: randomUUID(),
        requestChecksum: `chk-${randomUUID()}`,
        metadata: (over.metadata ?? {}) as never,
        createdAt: over.createdAt,
      },
      select: { id: true },
    });
    return txn.id;
  }

  // Seeds a completed/failed transaction linked to its Proposal + Quote — the
  // authoritative pricing snapshot `revenue()` now derives profit from (docs §5).
  // `fiatAmount` follows the production convention: GROSS on buy, NET (post-fee) on
  // sell. Returns the transaction id.
  async function seedTxnWithQuote(over: {
    userId: string;
    type: 'buy' | 'sell';
    status: string;
    createdAt: Date;
    fiatAmount: string;
    cryptoAmount: string;
    baseRate: string;
    processingFeeAmount: string;
    asset?: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const expiresAt = new Date(over.createdAt.getTime() + 60_000);
    const quote = await prisma.quote.create({
      data: {
        userId: over.userId,
        type: over.type as never,
        asset: over.asset ?? 'USDT',
        fiatCurrency: (over.metadata?.fiatCurrency ?? 'NGN') as never,
        fiatAmount: over.fiatAmount,
        cryptoAmount: over.cryptoAmount,
        fxRate: over.baseRate, // effective rate — not read by revenue()
        baseRate: over.baseRate,
        spreadBps: 0,
        processingFeeBps: 0,
        processingFeeAmount: over.processingFeeAmount,
        expiresAt,
      },
      select: { id: true },
    });
    const proposal = await prisma.proposal.create({
      data: {
        userId: over.userId,
        type: over.type as never,
        parameters: {},
        parametersChecksum: `chk-${randomUUID()}`,
        quoteId: quote.id,
        expiresAt,
      },
      select: { id: true },
    });
    const txn = await prisma.transaction.create({
      data: {
        userId: over.userId,
        type: over.type as never,
        status: over.status as never,
        idempotencyKey: randomUUID(),
        requestChecksum: `chk-${randomUUID()}`,
        metadata: (over.metadata ?? {}) as never,
        createdAt: over.createdAt,
        proposalId: proposal.id,
      },
      select: { id: true },
    });
    return txn.id;
  }

  // ── transactionVolume ──────────────────────────────────────────────────────

  describe('transactionVolume', () => {
    it('groups by type with completed/failed/stuck counts, a daily series, and success rate', async () => {
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
      // 2 buys STUCK (in-flight): one settling, one pending — must count toward
      // `stuck` (the sidebar-badge slice) but NOT toward successRate.
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'settling',
        createdAt: new Date('2026-06-02T09:00:00.000Z'),
      });
      await seedTxn({
        userId: u,
        type: 'buy',
        status: 'pending',
        createdAt: new Date('2026-06-02T09:30:00.000Z'),
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
      expect(buy.count).toBe(5);
      expect(buy.completed).toBe(2);
      expect(buy.failed).toBe(1);
      expect(buy.stuck).toBe(2);
      const send = result.byType.find((t) => t.type === 'send')!;
      expect(send.count).toBe(1);
      expect(send.completed).toBe(1);
      expect(send.failed).toBe(0);
      expect(send.stuck).toBe(0);

      // Daily series counts ALL statuses per day: 06-01 has 2 (buy completed +
      // buy failed); 06-02 has 4 (buy completed + buy settling + buy pending +
      // send completed).
      const d1 = result.series.find((b) => b.date === '2026-06-01')!;
      const d2 = result.series.find((b) => b.date === '2026-06-02')!;
      expect(d1.count).toBe(2);
      expect(d2.count).toBe(4);
      // No out-of-range date.
      expect(result.series.some((b) => b.date === '2026-05-15')).toBe(false);

      // successRate = completed (3) / (completed 3 + failed 1) = 0.75 — the two
      // stuck (in-flight) txns do NOT enter the success-rate denominator.
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
    it('derives fee + spread + profit per currency from the Quote of COMPLETED buy/sell txns', async () => {
      const u = await seedUser();
      // BUY (gross fiat 1115 − fee 100 = netFiat 1015; 1 unit at mid 1000 → spread 15).
      await seedTxnWithQuote({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-01T08:00:00.000Z'),
        fiatAmount: '1115',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '100',
      });
      // SELL (net fiat 935 + fee 50 = fiatBeforeFee 985; mid 1000 → spread 15).
      await seedTxnWithQuote({
        userId: u,
        type: 'sell',
        status: 'completed',
        createdAt: new Date('2026-06-02T08:00:00.000Z'),
        fiatAmount: '935',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '50',
      });
      // A FAILED buy — its quote must NOT count toward revenue.
      await seedTxnWithQuote({
        userId: u,
        type: 'buy',
        status: 'failed',
        createdAt: new Date('2026-06-03T08:00:00.000Z'),
        fiatAmount: '9999',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '999',
      });
      // OUT-OF-RANGE completed buy — excluded.
      await seedTxnWithQuote({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-05-01T08:00:00.000Z'),
        fiatAmount: '9999',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '777',
      });

      const result = await repo.revenue(FROM, TO);

      const fees = result.totalFeesByCurrency.find(
        (c) => c.currency === 'NGN',
      )!;
      const spread = result.totalSpreadByCurrency.find(
        (c) => c.currency === 'NGN',
      )!;
      const profit = result.totalProfitByCurrency.find(
        (c) => c.currency === 'NGN',
      )!;
      expect(fees.amount).toBe('150'); // buy 100 + sell 50 (both counted)
      expect(spread.amount).toBe('30'); // 15 + 15
      expect(profit.amount).toBe('180'); // fees + spread
      // txnCount = completed txns in range = 2 (failed + out-of-range excluded).
      expect(result.txnCount).toBe(2);
    });

    it('returns empty fees/spread/profit and txnCount 0 when no completed txns in range', async () => {
      const result = await repo.revenue(FROM, TO);
      expect(result.totalFeesByCurrency).toEqual([]);
      expect(result.totalSpreadByCurrency).toEqual([]);
      expect(result.totalProfitByCurrency).toEqual([]);
      expect(result.txnCount).toBe(0);
    });
  });

  // ── moneySeries ──────────────────────────────────────────────────────────────

  describe('moneySeries', () => {
    it('buckets per-day GMV (all money txns) + fee/profit (buy/sell Quote) per currency', async () => {
      const u = await seedUser();
      // 06-01 completed BUY: gross fiat 1115, mid 1000, fee 100 → fee 100, spread
      // 15, profit 115; GMV notional 1115 NGN.
      await seedTxnWithQuote({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-06-01T08:00:00.000Z'),
        fiatAmount: '1115',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '100',
        metadata: { fiatAmount: '1115', fiatCurrency: 'NGN' },
      });
      // 06-01 completed SEND (no quote): GMV-only, a SECOND currency (USD 2000).
      await seedTxn({
        userId: u,
        type: 'send',
        status: 'completed',
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        metadata: { fiatAmount: '2000', fiatCurrency: 'USD' },
      });
      // 06-02 completed SELL: net fiat 935, mid 1000, fee 50 → fee 50, spread 15,
      // profit 65; GMV notional 935 NGN.
      await seedTxnWithQuote({
        userId: u,
        type: 'sell',
        status: 'completed',
        createdAt: new Date('2026-06-02T08:00:00.000Z'),
        fiatAmount: '935',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '50',
        metadata: { fiatAmount: '935', fiatCurrency: 'NGN' },
      });
      // FAILED buy — excluded from every leg.
      await seedTxnWithQuote({
        userId: u,
        type: 'buy',
        status: 'failed',
        createdAt: new Date('2026-06-01T09:00:00.000Z'),
        fiatAmount: '9999',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '999',
        metadata: { fiatAmount: '9999', fiatCurrency: 'NGN' },
      });
      // OUT-OF-RANGE completed buy — excluded.
      await seedTxnWithQuote({
        userId: u,
        type: 'buy',
        status: 'completed',
        createdAt: new Date('2026-05-01T08:00:00.000Z'),
        fiatAmount: '8888',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '888',
        metadata: { fiatAmount: '8888', fiatCurrency: 'NGN' },
      });

      const result = await repo.moneySeries(FROM, TO);

      // Distinct currencies across the range, sorted.
      expect(result.currencies).toEqual(['NGN', 'USD']);

      // Two days with data, sorted ascending.
      expect(result.buckets.map((b) => b.date)).toEqual([
        '2026-06-01',
        '2026-06-02',
      ]);

      const pick = (arr: { currency: string; amount: string }[], c: string) =>
        arr.find((x) => x.currency === c)?.amount;

      const d1 = result.buckets[0];
      expect(pick(d1.gmv, 'NGN')).toBe('1115');
      expect(pick(d1.gmv, 'USD')).toBe('2000');
      expect(pick(d1.revenue, 'NGN')).toBe('100');
      // USD had GMV but no buy/sell quote → its fee/profit are 0.
      expect(pick(d1.revenue, 'USD')).toBe('0');
      expect(pick(d1.profit, 'NGN')).toBe('115');
      expect(pick(d1.profit, 'USD')).toBe('0');

      const d2 = result.buckets[1];
      expect(pick(d2.gmv, 'NGN')).toBe('935');
      expect(pick(d2.revenue, 'NGN')).toBe('50');
      expect(pick(d2.profit, 'NGN')).toBe('65');
    });

    it('returns empty buckets + currencies when no completed txns in range', async () => {
      const result = await repo.moneySeries(FROM, TO);
      expect(result.buckets).toEqual([]);
      expect(result.currencies).toEqual([]);
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
