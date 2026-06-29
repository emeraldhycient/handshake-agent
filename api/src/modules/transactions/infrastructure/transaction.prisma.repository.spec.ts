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
});
