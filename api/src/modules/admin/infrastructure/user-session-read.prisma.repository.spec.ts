import { UserSessionReadPrismaRepository } from './user-session-read.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const REVOKED_AT = new Date('2026-07-03T12:00:00.000Z');
const REASON = 'admin force sign-out';

function buildMockPrisma(
  overrides: {
    findMany?: jest.Mock;
    updateMany?: jest.Mock;
  } = {},
): PrismaService {
  return {
    session: {
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
      updateMany:
        overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;
}

describe('UserSessionReadPrismaRepository.revokeSession', () => {
  it('marks the session revoked scoped to BOTH user and session id, only if active', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = buildMockPrisma({ updateMany });
    const repo = new UserSessionReadPrismaRepository(prisma);

    const revoked = await repo.revokeSession(
      USER_ID,
      SESSION_ID,
      REVOKED_AT,
      REASON,
    );

    expect(updateMany).toHaveBeenCalledWith({
      // userId in the WHERE is what prevents a cross-user revoke; isActive:true
      // makes an already-revoked session a no-op (count 0 → false).
      where: { id: SESSION_ID, userId: USER_ID, isActive: true },
      data: { isActive: false, revokedAt: REVOKED_AT, revokedReason: REASON },
    });
    expect(revoked).toBe(true);
  });

  it('returns false when nothing matched (unknown id, wrong user, or already revoked)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = buildMockPrisma({ updateMany });
    const repo = new UserSessionReadPrismaRepository(prisma);

    const revoked = await repo.revokeSession(
      USER_ID,
      SESSION_ID,
      REVOKED_AT,
      REASON,
    );

    expect(revoked).toBe(false);
  });
});

describe('UserSessionReadPrismaRepository.revokeAllForUser', () => {
  it('marks every ACTIVE session of the user revoked and returns the count', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma = buildMockPrisma({ updateMany });
    const repo = new UserSessionReadPrismaRepository(prisma);

    const count = await repo.revokeAllForUser(USER_ID, REVOKED_AT, REASON);

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, isActive: true },
      data: { isActive: false, revokedAt: REVOKED_AT, revokedReason: REASON },
    });
    expect(count).toBe(3);
  });

  it('returns 0 when the user had no active sessions (idempotent no-op)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = buildMockPrisma({ updateMany });
    const repo = new UserSessionReadPrismaRepository(prisma);

    const count = await repo.revokeAllForUser(USER_ID, REVOKED_AT, REASON);

    expect(count).toBe(0);
  });
});
