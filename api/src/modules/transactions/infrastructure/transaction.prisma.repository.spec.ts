/**
 * Unit tests for TransactionPrismaRepository.
 *
 * TDD: tests written before implementation.
 *
 * UUID guard (bug fix): the Transaction.idempotencyKey column is typed
 * @db.Uuid in Postgres. Passing a non-UUID string (e.g. a Blockradar
 * manual-withdraw reference like "manual-sweep-2026") causes Prisma to
 * forward the value to Postgres which throws:
 *   "invalid input syntax for type uuid: ..."
 * crashing the webhook handler with a 500 instead of safely ignoring it.
 *
 * Fix: findByIdempotencyKey (and findById, which queries the same uuid-typed
 * primary key column) must return null immediately for any non-UUID input
 * without querying the database.
 *
 * Covered cases:
 *   findByIdempotencyKey:
 *   - non-UUID key → returns null, prisma.transaction.findUnique NOT called.
 *   - valid UUID key → delegates to prisma.transaction.findUnique.
 *   - valid UUID key with no matching row → returns null (normal not-found).
 *
 *   findById:
 *   - non-UUID id → returns null, prisma.transaction.findUnique NOT called.
 *   - valid UUID id → delegates to prisma.transaction.findUnique.
 */

import { TransactionPrismaRepository } from './transaction.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import { encodeCursor, decodeCursor } from '../domain/transaction-cursor';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const NON_UUID_KEYS = [
  'manual-sweep-2026',
  'withdraw-ref-not-a-uuid',
  '',
  'short',
  'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', // looks like UUID format but has non-hex chars
  '12345',
  'MANUAL_SWEEP_ABC',
];

// ---------------------------------------------------------------------------
// Stub PrismaService
// ---------------------------------------------------------------------------

function buildMockPrisma(findUniqueResult: unknown = null): {
  prisma: PrismaService;
  findUniqueMock: jest.Mock;
} {
  const findUniqueMock = jest.fn().mockResolvedValue(findUniqueResult);
  const prisma = {
    transaction: {
      findUnique: findUniqueMock,
    },
  } as unknown as PrismaService;
  return { prisma, findUniqueMock };
}

function makeRepo(findUniqueResult: unknown = null) {
  const { prisma, findUniqueMock } = buildMockPrisma(findUniqueResult);
  const repo = new TransactionPrismaRepository(prisma);
  return { repo, findUniqueMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TransactionPrismaRepository', () => {
  describe('findByIdempotencyKey — UUID guard', () => {
    it.each(NON_UUID_KEYS)(
      'non-UUID key "%s" → returns null without querying Prisma',
      async (nonUuidKey) => {
        const { repo, findUniqueMock } = makeRepo();

        const result = await repo.findByIdempotencyKey(nonUuidKey);

        expect(result).toBeNull();
        expect(findUniqueMock).not.toHaveBeenCalled();
      },
    );

    it('valid UUID key → delegates to prisma.transaction.findUnique', async () => {
      const dbRow = {
        id: VALID_UUID,
        proposalId: null,
        userId: 'user-uuid',
        type: 'SELL',
        status: 'completed',
        idempotencyKey: VALID_UUID,
        requestChecksum: 'abc123',
        fxRateSnapshot: null,
        metadata: {},
        processorTxRef: null,
        pinVerifiedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      const { repo, findUniqueMock } = makeRepo(dbRow);

      const result = await repo.findByIdempotencyKey(VALID_UUID);

      expect(findUniqueMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { idempotencyKey: VALID_UUID } }),
      );
      expect(result).not.toBeNull();
      expect(result?.idempotencyKey).toBe(VALID_UUID);
    });

    it('valid UUID key with no matching row → returns null (normal not-found)', async () => {
      const { repo, findUniqueMock } = makeRepo(null);

      const result = await repo.findByIdempotencyKey(VALID_UUID);

      expect(findUniqueMock).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('findById — UUID guard', () => {
    it.each(NON_UUID_KEYS)(
      'non-UUID id "%s" → returns null without querying Prisma',
      async (nonUuidId) => {
        const { repo, findUniqueMock } = makeRepo();

        const result = await repo.findById(nonUuidId);

        expect(result).toBeNull();
        expect(findUniqueMock).not.toHaveBeenCalled();
      },
    );

    it('valid UUID id → delegates to prisma.transaction.findUnique', async () => {
      const dbRow = {
        id: VALID_UUID,
        proposalId: null,
        userId: 'user-uuid',
        type: 'SELL',
        status: 'completed',
        idempotencyKey: VALID_UUID,
        requestChecksum: 'abc123',
        fxRateSnapshot: null,
        metadata: {},
        processorTxRef: null,
        pinVerifiedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      const { repo, findUniqueMock } = makeRepo(dbRow);

      const result = await repo.findById(VALID_UUID);

      expect(findUniqueMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: VALID_UUID } }),
      );
      expect(result).not.toBeNull();
      expect(result?.id).toBe(VALID_UUID);
    });
  });

  // ---------------------------------------------------------------------------
  // listByUserInRange — keyset pagination (GAP 2)
  // ---------------------------------------------------------------------------
  describe('listByUserInRange — keyset pagination', () => {
    const FROM = new Date('2026-06-01T00:00:00.000Z');
    const TO = new Date('2026-06-30T00:00:00.000Z');

    interface WhereArg {
      OR?: { createdAt: unknown; id?: unknown }[];
      type?: { in: string[] };
    }
    interface FindManyArgs {
      where: WhereArg;
      orderBy: unknown;
      take: number;
    }

    function row(id: string, iso: string) {
      return {
        id,
        proposalId: null,
        userId: 'u1',
        type: 'BUY',
        status: 'completed',
        idempotencyKey: VALID_UUID,
        requestChecksum: 'sum',
        fxRateSnapshot: null,
        metadata: {},
        processorTxRef: null,
        pinVerifiedAt: null,
        createdAt: new Date(iso),
      };
    }

    function makePagingRepo(findManyRows: unknown[], total: number) {
      // Capture the call args into typed locals so assertions stay type-safe
      // (reading jest's `.mock.calls` would surface `any`).
      const captured: { findMany?: FindManyArgs; count?: { where: WhereArg } } =
        {};
      const findMany = jest.fn((args: FindManyArgs) => {
        captured.findMany = args;
        return Promise.resolve(findManyRows);
      });
      const count = jest.fn((args: { where: WhereArg }) => {
        captured.count = args;
        return Promise.resolve(total);
      });
      const prisma = {
        transaction: { findMany, count },
        // Array-form $transaction: await both queued promises.
        $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      } as unknown as PrismaService;
      return { repo: new TransactionPrismaRepository(prisma), captured };
    }

    it('orders by (createdAt desc, id desc), fetches limit+1, and reports hasMore', async () => {
      // 3 rows returned for limit 2 → page is the first 2, hasMore true.
      const rows = [
        row('id-c', '2026-06-10T00:00:00.000Z'),
        row('id-b', '2026-06-09T00:00:00.000Z'),
        row('id-a', '2026-06-08T00:00:00.000Z'),
      ];
      const { repo, captured } = makePagingRepo(rows, 5);

      const res = await repo.listByUserInRange({
        userId: 'u1',
        from: FROM,
        to: TO,
        limit: 2,
      });

      expect(captured.findMany?.orderBy).toEqual([
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
      expect(captured.findMany?.take).toBe(3); // limit + 1
      // No cursor → no OR clause in either query.
      expect(captured.findMany?.where.OR).toBeUndefined();
      expect(captured.count?.where.OR).toBeUndefined();

      expect(res.rows).toHaveLength(2);
      expect(res.total).toBe(5);
      expect(res.hasMore).toBe(true);
      // nextCursor points at the LAST row of the trimmed page (id-b).
      expect(decodeCursor(res.nextCursor!)).toEqual({
        createdAt: new Date('2026-06-09T00:00:00.000Z'),
        id: 'id-b',
      });
    });

    it('returns hasMore=false and nextCursor=null on the final page', async () => {
      const rows = [row('id-b', '2026-06-09T00:00:00.000Z')];
      const { repo } = makePagingRepo(rows, 1);

      const res = await repo.listByUserInRange({
        userId: 'u1',
        from: FROM,
        to: TO,
        limit: 2,
      });

      expect(res.rows).toHaveLength(1);
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it('applies the keyset OR clause for a cursor (and counts the full window)', async () => {
      const cursorAt = new Date('2026-06-09T00:00:00.000Z');
      const cursor = encodeCursor(cursorAt, 'id-b');
      const { repo, captured } = makePagingRepo(
        [row('id-a', '2026-06-08T00:00:00.000Z')],
        5,
      );

      await repo.listByUserInRange({
        userId: 'u1',
        from: FROM,
        to: TO,
        limit: 2,
        cursor,
      });

      expect(captured.findMany?.where.OR).toEqual([
        { createdAt: { lt: cursorAt } },
        { createdAt: cursorAt, id: { lt: 'id-b' } },
      ]);
      // Count is the full-window total, so it must NOT carry the cursor OR.
      expect(captured.count?.where.OR).toBeUndefined();
    });

    it('narrows by type when types are provided', async () => {
      const { repo, captured } = makePagingRepo([], 0);
      await repo.listByUserInRange({
        userId: 'u1',
        from: FROM,
        to: TO,
        types: ['buy', 'deposit'],
        limit: 10,
      });
      expect(captured.findMany?.where.type).toEqual({
        in: ['buy', 'deposit'],
      });
    });

    it('ignores a malformed cursor (no OR clause)', async () => {
      const { repo, captured } = makePagingRepo([], 0);
      await repo.listByUserInRange({
        userId: 'u1',
        from: FROM,
        to: TO,
        limit: 10,
        cursor: 'not-a-valid-cursor',
      });
      expect(captured.findMany?.where.OR).toBeUndefined();
    });
  });
});
