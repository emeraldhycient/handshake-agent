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
    // uuid7 is time-ordered; desc ordering means the larger id (later-created) is first.
    expect(rows[0].id > rows[1].id).toBe(true);
    expect(rows.every((r) => r.userId === userId)).toBe(true);
  });

  it('findByUserId respects the limit parameter', async () => {
    // The user already has 2 rows from the previous test; request only 1.
    const rows = await repo.findByUserId(userId, { limit: 1 });
    expect(rows).toHaveLength(1);
  });

  it('findByUserId respects the cursor (keyset pagination on id)', async () => {
    // Fetch all rows first, then use the id of the first (newest) row as cursor.
    // Rows with id < that cursor (i.e. older rows) should be returned.
    const allRows = await repo.findByUserId(userId, { limit: 10 });
    expect(allRows.length).toBeGreaterThanOrEqual(2);

    const cursor = allRows[0].id; // newest row's id
    const rows = await repo.findByUserId(userId, { limit: 10, cursor });
    // Must include only rows older than the cursor (id < cursor in uuid7 ordering).
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.id < cursor)).toBe(true);
  });

  it('findByUserId returns empty array when no transactions exist for user', async () => {
    const emptyUser = await prisma.user.create({ data: {} });
    const rows = await repo.findByUserId(emptyUser.id, { limit: 10 });
    expect(rows).toHaveLength(0);
  });

  it('findByUserId does not drop rows when two transactions share the same createdAt (tie-breaker via uuid7 id)', async () => {
    // Seed a fresh user to isolate this test from previous seeds.
    const tieUser = await prisma.user.create({ data: {} });
    const sameCreatedAt = new Date('2026-06-29T12:00:00.000Z');
    const meta = {
      asset: 'USDT',
      cryptoAmount: '1',
      fiatAmount: '1000',
      fiatCurrency: 'NGN',
    };

    // Create two transactions with the EXACT same createdAt millisecond.
    // With the old createdAt-cursor approach this would silently drop one row.
    const txA = await prisma.transaction.create({
      data: {
        userId: tieUser.id,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'd'.repeat(64),
        metadata: meta,
        createdAt: sameCreatedAt,
      },
    });

    const txB = await prisma.transaction.create({
      data: {
        userId: tieUser.id,
        type: 'buy',
        status: 'completed',
        idempotencyKey: randomUUID(),
        requestChecksum: 'e'.repeat(64),
        metadata: meta,
        createdAt: sameCreatedAt,
      },
    });

    // Fetch page 1 with limit 1 — gets the newer id (uuid7 desc order).
    const page1 = await repo.findByUserId(tieUser.id, { limit: 1 });
    expect(page1).toHaveLength(1);

    // The cursor is the last-seen id from page 1.
    const cursor = page1[0].id;

    // Fetch page 2 using that cursor — must return the other row.
    const page2 = await repo.findByUserId(tieUser.id, { limit: 1, cursor });
    expect(page2).toHaveLength(1);

    // Together, both distinct rows appear exactly once — no row is dropped.
    const allIds = [page1[0].id, page2[0].id].sort();
    const expectedIds = [txA.id, txB.id].sort();
    expect(allIds).toEqual(expectedIds);
  });
});
