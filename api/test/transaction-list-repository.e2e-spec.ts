/**
 * Integration test for TransactionPrismaRepository.findByUserId (Task 2).
 *
 * Verifies keyset-paginated listing of a user's transactions against a REAL
 * Postgres schema (Testcontainers). Requires Docker.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { TransactionPrismaRepository } from '../src/modules/transactions/infrastructure/transaction.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('TransactionPrismaRepository.findByUserId (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: TransactionPrismaRepository;

  let userId: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    // Boundary cast: PrismaClient → PrismaService (same API surface; safe at runtime).
    repo = new TransactionPrismaRepository(prisma as unknown as PrismaService);

    // Seed a User row (FK required by Transaction).
    const user = await prisma.user.create({ data: {} });
    userId = user.id;
  });

  afterAll(async () => {
    await stop?.();
  });

  it('findByUserId returns transactions newest-first, filtered to the user', async () => {
    const meta = {
      asset: 'USDT',
      cryptoAmount: '1',
      fiatAmount: '1000',
      fiatCurrency: 'NGN',
    };

    // Seed two transactions for the target user with deterministic timestamps
    // so the desc ordering is verifiable.
    await prisma.transaction.create({
      data: {
        userId,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'a'.repeat(64),
        metadata: meta,
        createdAt: new Date('2026-06-29T10:00:00.000Z'),
      },
    });

    await prisma.transaction.create({
      data: {
        userId,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'b'.repeat(64),
        metadata: meta,
        createdAt: new Date('2026-06-29T11:00:00.000Z'),
      },
    });

    // Seed a transaction for a different user — must NOT appear in results.
    const otherUser = await prisma.user.create({ data: {} });
    await prisma.transaction.create({
      data: {
        userId: otherUser.id,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'c'.repeat(64),
        metadata: meta,
      },
    });

    const rows = await repo.findByUserId(userId, { limit: 10 });

    expect(rows).toHaveLength(2);
    expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      rows[1].createdAt.getTime(),
    ); // desc
    expect(rows.every((r) => r.userId === userId)).toBe(true);
  });

  it('findByUserId respects the limit parameter', async () => {
    // The user already has 2 rows from the previous test; request only 1.
    const rows = await repo.findByUserId(userId, { limit: 1 });
    expect(rows).toHaveLength(1);
    // Should be the newest one (11:00)
    expect(rows[0].createdAt.toISOString()).toBe('2026-06-29T11:00:00.000Z');
  });

  it('findByUserId respects the cursor (keyset pagination)', async () => {
    // cursor = the createdAt of the newest row → only rows BEFORE it are returned
    const cursor = '2026-06-29T11:00:00.000Z';
    const rows = await repo.findByUserId(userId, { limit: 10, cursor });
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt.toISOString()).toBe('2026-06-29T10:00:00.000Z');
  });

  it('findByUserId returns empty array when no transactions exist for user', async () => {
    const emptyUser = await prisma.user.create({ data: {} });
    const rows = await repo.findByUserId(emptyUser.id, { limit: 10 });
    expect(rows).toHaveLength(0);
  });
});
