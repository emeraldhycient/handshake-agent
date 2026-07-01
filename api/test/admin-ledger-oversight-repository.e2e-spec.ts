/**
 * Integration test for LedgerPrismaRepository admin-oversight reads
 * (Phase 3, sub-area A — READ-ONLY): listByTransaction, getAccountHistory,
 * verifyTransactionIntegrity. Real Postgres schema (Testcontainers).
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { LedgerPrismaRepository } from '../src/modules/transactions/infrastructure/ledger.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('LedgerPrismaRepository admin-oversight reads (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: LedgerPrismaRepository;

  let userId: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    repo = new LedgerPrismaRepository(prisma as unknown as PrismaService);
    userId = (await prisma.user.create({ data: {} })).id;
  });

  afterAll(async () => {
    await stop?.();
  });

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.transaction.deleteMany();
  });

  async function seedTxn(): Promise<string> {
    const txn = await prisma.transaction.create({
      data: {
        userId,
        type: 'send' as never,
        status: 'completed' as never,
        idempotencyKey: randomUUID(),
        requestChecksum: `chk-${randomUUID()}`,
        metadata: {},
      },
      select: { id: true },
    });
    return txn.id;
  }

  async function seedLeg(
    txnId: string,
    over: {
      accountType?: string;
      accountId: string;
      currency: string;
      amount: string;
      direction: 'debit' | 'credit';
      balanceAfter?: string;
      sequence: number;
      postedAt?: Date;
    },
  ): Promise<void> {
    await prisma.ledgerEntry.create({
      data: {
        transactionId: txnId,
        accountType: (over.accountType ?? 'user_wallet') as never,
        accountId: over.accountId,
        currency: over.currency,
        amount: over.amount,
        direction: over.direction as never,
        description: 'seed',
        balanceAfter: over.balanceAfter ?? '0',
        sequence: over.sequence,
        postedAt: over.postedAt ?? new Date(),
      },
    });
  }

  describe('listByTransaction', () => {
    it('returns all legs of a txn ordered by sequence ascending', async () => {
      const txnId = await seedTxn();
      await seedLeg(txnId, {
        accountId: 'wallet-1',
        currency: 'USDT',
        amount: '-10',
        direction: 'debit',
        balanceAfter: '90',
        sequence: 2,
      });
      await seedLeg(txnId, {
        accountType: 'platform_float',
        accountId: 'float-1',
        currency: 'USDT',
        amount: '10',
        direction: 'credit',
        balanceAfter: '10',
        sequence: 1,
      });

      const legs = await repo.listByTransaction(txnId);
      expect(legs).toHaveLength(2);
      // Posting order: sequence 1 first.
      expect(legs[0].sequence).toBe(1);
      expect(legs[1].sequence).toBe(2);
      expect(legs[0]).toMatchObject({
        transactionId: txnId,
        accountType: 'platform_float',
        accountId: 'float-1',
        currency: 'USDT',
        direction: 'credit',
      });
      expect(legs[0].amount).toBe('10');
    });

    it('returns an empty array for an unknown txn', async () => {
      expect(await repo.listByTransaction(randomUUID())).toEqual([]);
    });
  });

  describe('getAccountHistory', () => {
    it('returns recent N entries newest-first for the account triple', async () => {
      const txnId = await seedTxn();
      const accountId = 'wallet-hist';
      for (let seq = 1; seq <= 3; seq++) {
        await seedLeg(txnId, {
          accountId,
          currency: 'USDT',
          amount: `${seq}`,
          direction: 'credit',
          balanceAfter: `${seq}0`,
          sequence: seq,
          postedAt: new Date(`2026-01-0${seq}T00:00:00.000Z`),
        });
      }

      const entries = await repo.getAccountHistory(
        'user_wallet',
        accountId,
        'USDT',
        2,
      );
      expect(entries).toHaveLength(2);
      expect(entries[0].sequence).toBe(3);
      expect(entries[1].sequence).toBe(2);
    });

    it('scopes to the (accountType, accountId, currency) triple', async () => {
      const txnId = await seedTxn();
      await seedLeg(txnId, {
        accountId: 'acct',
        currency: 'USDT',
        amount: '1',
        direction: 'credit',
        sequence: 1,
      });
      await seedLeg(txnId, {
        accountId: 'acct',
        currency: 'NGN',
        amount: '5',
        direction: 'credit',
        sequence: 2,
      });

      const usdt = await repo.getAccountHistory(
        'user_wallet',
        'acct',
        'USDT',
        10,
      );
      expect(usdt).toHaveLength(1);
      expect(usdt[0].currency).toBe('USDT');
    });
  });

  describe('verifyTransactionIntegrity', () => {
    it('reports balanced=true when every currency nets to zero', async () => {
      const txnId = await seedTxn();
      // USDT: -10 + 10 = 0
      await seedLeg(txnId, {
        accountId: 'wallet-1',
        currency: 'USDT',
        amount: '-10',
        direction: 'debit',
        sequence: 1,
      });
      await seedLeg(txnId, {
        accountType: 'platform_float',
        accountId: 'float-1',
        currency: 'USDT',
        amount: '10',
        direction: 'credit',
        sequence: 2,
      });

      const result = await repo.verifyTransactionIntegrity(txnId);
      expect(result.balanced).toBe(true);
      expect(result.legCount).toBe(2);
      expect(result.brokenAt).toBe(null);
    });

    it('reports balanced=false and names the broken currency', async () => {
      const txnId = await seedTxn();
      // USDT nets to zero; NGN does NOT (-5 only).
      await seedLeg(txnId, {
        accountId: 'wallet-1',
        currency: 'USDT',
        amount: '-10',
        direction: 'debit',
        sequence: 1,
      });
      await seedLeg(txnId, {
        accountType: 'platform_float',
        accountId: 'float-1',
        currency: 'USDT',
        amount: '10',
        direction: 'credit',
        sequence: 2,
      });
      await seedLeg(txnId, {
        accountId: 'wallet-1',
        currency: 'NGN',
        amount: '-5',
        direction: 'debit',
        sequence: 3,
      });

      const result = await repo.verifyTransactionIntegrity(txnId);
      expect(result.balanced).toBe(false);
      expect(result.legCount).toBe(3);
      expect(result.brokenAt).toBe('NGN');
    });

    it('reports balanced=false with legCount 0 for a txn with no legs', async () => {
      const txnId = await seedTxn();
      const result = await repo.verifyTransactionIntegrity(txnId);
      expect(result.balanced).toBe(false);
      expect(result.legCount).toBe(0);
      expect(result.brokenAt).toBe(null);
    });
  });
});
