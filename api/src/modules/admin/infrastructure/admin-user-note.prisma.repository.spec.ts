import { AdminUserNotePrismaRepository } from './admin-user-note.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';

function buildMockPrisma(
  overrides: {
    create?: jest.Mock;
    findMany?: jest.Mock;
  } = {},
): PrismaService {
  return {
    adminUserNote: {
      create: overrides.create ?? jest.fn().mockResolvedValue({}),
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

describe('AdminUserNotePrismaRepository', () => {
  describe('create', () => {
    it('inserts the note with the supplied user/author/body and returns the record', async () => {
      const persisted = {
        id: 'note-1',
        userId: 'user-1',
        authorAdminId: 'admin-1',
        body: 'Case note.',
        createdAt: new Date('2026-07-03T10:00:00.000Z'),
      };
      const create = jest.fn().mockResolvedValue(persisted);
      const prisma = buildMockPrisma({ create });
      const repo = new AdminUserNotePrismaRepository(prisma);

      const result = await repo.create({
        userId: 'user-1',
        authorAdminId: 'admin-1',
        body: 'Case note.',
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          authorAdminId: 'admin-1',
          body: 'Case note.',
        },
      });
      expect(result).toEqual(persisted);
    });
  });

  describe('listForUser', () => {
    it('queries by userId ordered newest-first and returns the records', async () => {
      const rows = [
        {
          id: 'note-a',
          userId: 'user-7',
          authorAdminId: 'admin-1',
          body: 'Newer.',
          createdAt: new Date('2026-07-03T12:00:00.000Z'),
        },
        {
          id: 'note-b',
          userId: 'user-7',
          authorAdminId: 'admin-2',
          body: 'Older.',
          createdAt: new Date('2026-07-03T09:00:00.000Z'),
        },
      ];
      const findMany = jest.fn().mockResolvedValue(rows);
      const prisma = buildMockPrisma({ findMany });
      const repo = new AdminUserNotePrismaRepository(prisma);

      const result = await repo.listForUser('user-7');

      expect(findMany).toHaveBeenCalledWith({
        where: { userId: 'user-7' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(rows);
    });

    it('returns an empty array when the user has no notes', async () => {
      const prisma = buildMockPrisma({
        findMany: jest.fn().mockResolvedValue([]),
      });
      const repo = new AdminUserNotePrismaRepository(prisma);

      const result = await repo.listForUser('user-7');

      expect(result).toEqual([]);
    });
  });
});
