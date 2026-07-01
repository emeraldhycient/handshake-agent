/**
 * Integration test for TransactionPrismaRepository.listAll / listByStatus
 * (Phase 3, sub-area A — admin transactions oversight, READ-ONLY).
 *
 * Verifies cross-user keyset listing (createdAt desc, id desc) with status/type/
 * userId/from/to filters against a REAL Postgres schema (Testcontainers).
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { TransactionPrismaRepository } from '../src/modules/transactions/infrastructure/transaction.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('TransactionPrismaRepository.listAll / listByStatus (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: TransactionPrismaRepository;

  let userA: string;
  let userB: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    repo = new TransactionPrismaRepository(prisma as unknown as PrismaService);

    userA = (await prisma.user.create({ data: {} })).id;
    userB = (await prisma.user.create({ data: {} })).id;
  });

  afterAll(async () => {
    await stop?.();
  });

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.transaction.deleteMany();
  });

  async function seedTxn(
    userId: string,
    type: string,
    status: string,
    createdAt: Date,
  ): Promise<string> {
    const txn = await prisma.transaction.create({
      data: {
        userId,
        type: type as never,
        status: status as never,
        idempotencyKey: randomUUID(),
        requestChecksum: `chk-${randomUUID()}`,
        metadata: { seeded: true },
        createdAt,
      },
      select: { id: true },
    });
    return txn.id;
  }

  it('listAll returns transactions across all users, newest-first', async () => {
    const oldId = await seedTxn(
      userA,
      'buy',
      'completed',
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const midId = await seedTxn(
      userB,
      'sell',
      'settling',
      new Date('2026-01-02T00:00:00.000Z'),
    );
    const newId = await seedTxn(
      userA,
      'send',
      'failed',
      new Date('2026-01-03T00:00:00.000Z'),
    );

    const { items, nextCursor } = await repo.listAll({}, { limit: 10 });

    expect(items.map((t) => t.id)).toEqual([newId, midId, oldId]);
    // Page is shorter than limit → no more rows.
    expect(nextCursor).toBeNull();
  });

  it('listAll keyset-paginates with nextCursor', async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      ids.push(
        await seedTxn(
          userA,
          'buy',
          'completed',
          new Date(`2026-01-0${i}T00:00:00.000Z`),
        ),
      );
    }
    // Newest-first: ids[2], ids[1], ids[0].
    const page1 = await repo.listAll({}, { limit: 2 });
    expect(page1.items.map((t) => t.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).toBe(ids[1]);

    const page2 = await repo.listAll(
      {},
      { limit: 2, cursor: page1.nextCursor! },
    );
    expect(page2.items.map((t) => t.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
  });

  it('listAll filters by status, type and userId', async () => {
    await seedTxn(userA, 'buy', 'completed', new Date('2026-01-01T00:00:00Z'));
    const settlingId = await seedTxn(
      userA,
      'send',
      'settling',
      new Date('2026-01-02T00:00:00Z'),
    );
    await seedTxn(userB, 'send', 'settling', new Date('2026-01-03T00:00:00Z'));

    const byStatus = await repo.listAll({ status: 'settling' }, { limit: 10 });
    expect(byStatus.items.map((t) => t.status)).toEqual([
      'settling',
      'settling',
    ]);

    const byType = await repo.listAll({ type: 'send' }, { limit: 10 });
    expect(byType.items.every((t) => t.type === 'send')).toBe(true);

    const byUser = await repo.listAll(
      { userId: userA, status: 'settling' },
      { limit: 10 },
    );
    expect(byUser.items).toHaveLength(1);
    expect(byUser.items[0].id).toBe(settlingId);
  });

  it('listAll filters by the from/to createdAt window', async () => {
    await seedTxn(userA, 'buy', 'completed', new Date('2026-01-01T00:00:00Z'));
    const inWindow = await seedTxn(
      userA,
      'buy',
      'completed',
      new Date('2026-01-15T00:00:00Z'),
    );
    await seedTxn(userA, 'buy', 'completed', new Date('2026-02-01T00:00:00Z'));

    const { items } = await repo.listAll(
      {
        from: new Date('2026-01-10T00:00:00Z'),
        to: new Date('2026-01-20T00:00:00Z'),
      },
      { limit: 10 },
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(inWindow);
  });

  it('listByStatus is listAll pre-filtered to one status', async () => {
    await seedTxn(userA, 'buy', 'completed', new Date('2026-01-01T00:00:00Z'));
    const settlingId = await seedTxn(
      userB,
      'sell',
      'settling',
      new Date('2026-01-02T00:00:00Z'),
    );

    const { items } = await repo.listByStatus('settling', { limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(settlingId);
  });
});
