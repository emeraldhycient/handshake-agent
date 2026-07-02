import { AdminPreferencesPrismaRepository } from './admin-preferences.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';

function buildMockPrisma(
  overrides: {
    findUnique?: jest.Mock;
    upsert?: jest.Mock;
  } = {},
): PrismaService {
  return {
    adminPreferences: {
      findUnique: overrides.findUnique ?? jest.fn().mockResolvedValue(null),
      upsert: overrides.upsert ?? jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
}

describe('AdminPreferencesPrismaRepository', () => {
  describe('get', () => {
    it('returns the three booleans when a row exists', async () => {
      const findUnique = jest.fn().mockResolvedValue({
        emailAlerts: false,
        approvalMentions: true,
        weeklyDigest: false,
      });
      const prisma = buildMockPrisma({ findUnique });
      const repo = new AdminPreferencesPrismaRepository(prisma);

      const result = await repo.get('admin-1');

      expect(findUnique).toHaveBeenCalledWith({
        where: { adminId: 'admin-1' },
        select: {
          emailAlerts: true,
          approvalMentions: true,
          weeklyDigest: true,
        },
      });
      expect(result).toEqual({
        emailAlerts: false,
        approvalMentions: true,
        weeklyDigest: false,
      });
    });

    it('returns null when no row exists', async () => {
      const prisma = buildMockPrisma({
        findUnique: jest.fn().mockResolvedValue(null),
      });
      const repo = new AdminPreferencesPrismaRepository(prisma);

      const result = await repo.get('admin-1');

      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    it('upserts keyed on adminId with the new prefs in both create and update', async () => {
      const persisted = {
        emailAlerts: false,
        approvalMentions: false,
        weeklyDigest: true,
      };
      const upsert = jest.fn().mockResolvedValue(persisted);
      const prisma = buildMockPrisma({ upsert });
      const repo = new AdminPreferencesPrismaRepository(prisma);

      const result = await repo.upsert('admin-2', persisted);

      expect(upsert).toHaveBeenCalledWith({
        where: { adminId: 'admin-2' },
        create: { adminId: 'admin-2', ...persisted },
        update: persisted,
        select: {
          emailAlerts: true,
          approvalMentions: true,
          weeklyDigest: true,
        },
      });
      expect(result).toEqual(persisted);
    });
  });
});
