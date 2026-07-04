import { BlockedListPrismaRepository } from './blocked-list.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';

function buildMockPrisma(
  overrides: {
    findMany?: jest.Mock;
    findUnique?: jest.Mock;
    create?: jest.Mock;
    updateMany?: jest.Mock;
  } = {},
): PrismaService {
  return {
    blockedEntry: {
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
      findUnique: overrides.findUnique ?? jest.fn().mockResolvedValue(null),
      create: overrides.create ?? jest.fn().mockResolvedValue({}),
      updateMany:
        overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;
}

const ROW = {
  id: 'blk-1',
  kind: 'address' as const,
  value: 'TXYZ',
  reason: 'flagged',
  addedByAdminId: 'admin-1',
  createdAt: new Date('2026-07-03T10:00:00.000Z'),
  supersededAt: null,
  supersededByAdminId: null,
};

describe('BlockedListPrismaRepository', () => {
  describe('listActive', () => {
    it('queries only active entries (supersededAt null) newest-first and maps the record', async () => {
      const findMany = jest.fn().mockResolvedValue([ROW]);
      const repo = new BlockedListPrismaRepository(
        buildMockPrisma({ findMany }),
      );

      const result = await repo.listActive();

      expect(findMany).toHaveBeenCalledWith({
        where: { supersededAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([
        {
          id: 'blk-1',
          kind: 'address',
          value: 'TXYZ',
          reason: 'flagged',
          addedByAdminId: 'admin-1',
          createdAt: ROW.createdAt,
          supersededAt: null,
        },
      ]);
    });
  });

  describe('findById', () => {
    it('returns the mapped record when found', async () => {
      const findUnique = jest.fn().mockResolvedValue(ROW);
      const repo = new BlockedListPrismaRepository(
        buildMockPrisma({ findUnique }),
      );

      const result = await repo.findById('blk-1');

      expect(findUnique).toHaveBeenCalledWith({ where: { id: 'blk-1' } });
      expect(result?.id).toBe('blk-1');
    });

    it('returns null when absent', async () => {
      const repo = new BlockedListPrismaRepository(
        buildMockPrisma({ findUnique: jest.fn().mockResolvedValue(null) }),
      );
      expect(await repo.findById('nope')).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts the active block and returns the mapped record', async () => {
      const create = jest.fn().mockResolvedValue(ROW);
      const repo = new BlockedListPrismaRepository(buildMockPrisma({ create }));

      const result = await repo.create({
        kind: 'address',
        value: 'TXYZ',
        reason: 'flagged',
        addedByAdminId: 'admin-1',
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          kind: 'address',
          value: 'TXYZ',
          reason: 'flagged',
          addedByAdminId: 'admin-1',
        },
      });
      expect(result.id).toBe('blk-1');
      expect(result.supersededAt).toBeNull();
    });
  });

  describe('supersede', () => {
    it('stamps supersededAt/By only on an ACTIVE row then re-reads it', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const superseded = {
        ...ROW,
        supersededAt: new Date('2026-07-03T12:00:00.000Z'),
        supersededByAdminId: 'admin-2',
      };
      const findUnique = jest.fn().mockResolvedValue(superseded);
      const repo = new BlockedListPrismaRepository(
        buildMockPrisma({ updateMany, findUnique }),
      );

      const result = await repo.supersede('blk-1', 'admin-2');

      // Scoped to supersededAt: null → an already-lifted row is never re-stamped,
      // and it stamps a real Date + the acting admin as supersededByAdminId.
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'blk-1', supersededAt: null },
        data: {
          supersededAt: expect.any(Date) as Date,
          supersededByAdminId: 'admin-2',
        },
      });
      expect(result?.supersededAt).toEqual(superseded.supersededAt);
    });

    it('returns null (no re-read) when the row is unknown or already lifted (count 0)', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const findUnique = jest.fn();
      const repo = new BlockedListPrismaRepository(
        buildMockPrisma({ updateMany, findUnique }),
      );

      const result = await repo.supersede('nope', 'admin-2');

      expect(result).toBeNull();
      expect(findUnique).not.toHaveBeenCalled();
    });
  });
});
