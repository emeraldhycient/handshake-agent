import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { LedgerPrismaRepository } from '../src/modules/transactions/infrastructure/ledger.prisma.repository';
import { TransactionReadPrismaRepository } from '../src/modules/transactions/infrastructure/transaction-read.prisma.repository';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let ledgerRepo: LedgerPrismaRepository;
let txnReadRepo: TransactionReadPrismaRepository;

async function seedUser(): Promise<string> {
  const user = await prisma.user.create({ data: {} });
  return user.id;
}

async function seedTransaction(
  userId: string,
  type: string,
  status: string,
  createdAt?: Date,
): Promise<string> {
  const txn = await prisma.transaction.create({
    data: {
      userId,
      type: type as never,
      status: status as never,
      idempotencyKey: randomUUID(),
      requestChecksum: `chk-${randomUUID()}`,
      metadata: { seeded: true },
      ...(createdAt ? { createdAt } : {}),
    },
    select: { id: true },
  });
  return txn.id;
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  ledgerRepo = new LedgerPrismaRepository(prisma as unknown as PrismaService);
  txnReadRepo = new TransactionReadPrismaRepository(
    prisma as unknown as PrismaService,
  );
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await prisma.ledgerEntry.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.user.deleteMany();
});

describe('LedgerPrismaRepository.listLedgerEntries (integration)', () => {
  it('returns recent N entries newest-first and maps the record shape', async () => {
    const userId = await seedUser();
    const txnId = await seedTransaction(userId, 'deposit', 'completed');
    const accountId = randomUUID();

    for (let seq = 1; seq <= 3; seq++) {
      await prisma.ledgerEntry.create({
        data: {
          transactionId: txnId,
          accountType: 'user_wallet' as never,
          accountId,
          currency: 'USDT',
          amount: `${seq}.5`,
          direction: 'credit' as never,
          description: `entry ${seq}`,
          balanceAfter: `${seq}0.0`,
          sequence: seq,
          postedAt: new Date(`2026-01-0${seq}T00:00:00.000Z`),
        },
      });
    }

    const entries = await ledgerRepo.listLedgerEntries(
      'user_wallet',
      accountId,
      2,
    );

    expect(entries).toHaveLength(2);
    // Newest-first by sequence: seq 3 (balanceAfter 30) then seq 2 (20).
    expect(entries[0].balanceAfter).toBe('30');
    expect(entries[1].balanceAfter).toBe('20');

    expect(entries[0]).toMatchObject({
      transactionId: txnId,
      accountType: 'user_wallet',
      accountId,
      currency: 'USDT',
      direction: 'credit',
    });
    expect(entries[0].amount).toBe('3.5');
    expect(entries[0].postedAt).toBeInstanceOf(Date);
    expect(typeof entries[0].id).toBe('string');
  });

  it('scopes to the (accountType, accountId) pair', async () => {
    const userId = await seedUser();
    const txnId = await seedTransaction(userId, 'deposit', 'completed');
    const mine = randomUUID();
    const other = randomUUID();

    await prisma.ledgerEntry.create({
      data: {
        transactionId: txnId,
        accountType: 'user_wallet' as never,
        accountId: mine,
        currency: 'USDT',
        amount: '1',
        direction: 'credit' as never,
        description: 'mine',
        balanceAfter: '1',
        sequence: 1,
        postedAt: new Date(),
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        transactionId: txnId,
        accountType: 'user_wallet' as never,
        accountId: other,
        currency: 'USDT',
        amount: '9',
        direction: 'credit' as never,
        description: 'other',
        balanceAfter: '9',
        sequence: 1,
        postedAt: new Date(),
      },
    });

    const entries = await ledgerRepo.listLedgerEntries('user_wallet', mine, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].accountId).toBe(mine);
  });

  it('returns an empty array when no entries exist', async () => {
    const entries = await ledgerRepo.listLedgerEntries(
      'user_wallet',
      randomUUID(),
      10,
    );
    expect(entries).toEqual([]);
  });
});

describe('TransactionReadPrismaRepository.listForUser (integration)', () => {
  it('returns recent N transactions newest-first, scoped to the user', async () => {
    const userId = await seedUser();
    const otherId = await seedUser();

    await seedTransaction(
      userId,
      'buy',
      'completed',
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const midId = await seedTransaction(
      userId,
      'sell',
      'pending',
      new Date('2026-01-02T00:00:00.000Z'),
    );
    const newestId = await seedTransaction(
      userId,
      'send',
      'failed',
      new Date('2026-01-03T00:00:00.000Z'),
    );
    await seedTransaction(otherId, 'buy', 'completed');

    const list = await txnReadRepo.listForUser(userId, 2);

    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(newestId);
    expect(list[1].id).toBe(midId);
    expect(list[0]).toMatchObject({
      id: newestId,
      type: 'send',
      status: 'failed',
    });
    expect(list[0].createdAt).toBeInstanceOf(Date);
  });

  it('returns an empty array for a user with no transactions', async () => {
    const userId = await seedUser();
    expect(await txnReadRepo.listForUser(userId, 10)).toEqual([]);
  });
});
