/**
 * Unit tests for AuthUserPrismaRepository.markEmailVerified — Task 2.1
 * (onboarding redesign): email verification now grants kycTier=tier_1 +
 * status=active, guarded so it only ever promotes a fresh `unverified` user.
 *
 * No Nest TestingModule — the repository is constructed directly with a faked
 * PrismaService whose `$transaction` invokes the callback with stub `tx`
 * writers (mirrors the pattern in kyc.prisma.repository.spec.ts). Both writes
 * now run inside one interactive transaction so a crash/DB-error between them
 * can never leave emailVerifiedAt stamped without the tier grant (or vice
 * versa) — the `where: { kycTier: 'unverified' }` guard on the second call is
 * what makes the promotion itself atomic (no read-then-write race) and
 * non-downgrading; Prisma enforces it at the DB level (also exercised
 * end-to-end in auth-user-repository.e2e-spec.ts).
 */

import type { PrismaService } from '../../../core/prisma/prisma.service';
import { AuthUserPrismaRepository } from './auth-user.prisma.repository';

type UserUpdateArg = {
  where: { id: string };
  data: { emailVerifiedAt: Date };
};
type UserUpdateManyArg = {
  where: { id: string; kycTier: string };
  data: { kycTier: string; status: string; tierChangedAt: Date };
};

interface CapturedWrites {
  userUpdate: jest.Mock<Promise<void>, [UserUpdateArg]>;
  userUpdateMany: jest.Mock<Promise<{ count: number }>, [UserUpdateManyArg]>;
}

function makePrisma(captured: CapturedWrites): PrismaService {
  const tx = {
    user: {
      update: captured.userUpdate,
      updateMany: captured.userUpdateMany,
    },
  };

  return {
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;
}

function freshCaptured(): CapturedWrites {
  return {
    userUpdate: jest.fn<Promise<void>, [UserUpdateArg]>(() =>
      Promise.resolve(undefined),
    ),
    userUpdateMany: jest.fn<Promise<{ count: number }>, [UserUpdateManyArg]>(
      () => Promise.resolve({ count: 1 }),
    ),
  };
}

describe('AuthUserPrismaRepository.markEmailVerified', () => {
  const now = new Date('2026-07-13T12:00:00.000Z');

  it('always stamps emailVerifiedAt on the User row', async () => {
    const captured = freshCaptured();
    const repo = new AuthUserPrismaRepository(makePrisma(captured));

    await repo.markEmailVerified('u1', now);

    expect(captured.userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerifiedAt: now },
    });
  });

  it('grants tier_1 + active status via a conditional write guarded to unverified users only', async () => {
    const captured = freshCaptured();
    const repo = new AuthUserPrismaRepository(makePrisma(captured));

    await repo.markEmailVerified('u1', now);

    // The guard is the `where: { kycTier: 'unverified' }` clause itself — this
    // is what Prisma/Postgres evaluates atomically server-side, so a user
    // already at tier_1/2/3 never matches and is left untouched (no downgrade,
    // no tierChangedAt re-stamp — which would wrongly restart the tier-change
    // cooling-off window, §3.3).
    expect(captured.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'u1', kycTier: 'unverified' },
      data: { kycTier: 'tier_1', status: 'active', tierChangedAt: now },
    });
  });

  it('performs the emailVerifiedAt stamp before the guarded tier-grant write', async () => {
    const captured = freshCaptured();
    const calls: string[] = [];
    captured.userUpdate.mockImplementation(() => {
      calls.push('update');
      return Promise.resolve(undefined);
    });
    captured.userUpdateMany.mockImplementation(() => {
      calls.push('updateMany');
      return Promise.resolve({ count: 1 });
    });
    const repo = new AuthUserPrismaRepository(makePrisma(captured));

    await repo.markEmailVerified('u1', now);

    expect(calls).toEqual(['update', 'updateMany']);
  });

  it('runs both writes inside a single $transaction (atomic pair)', async () => {
    const captured = freshCaptured();
    const prisma = makePrisma(captured);
    const repo = new AuthUserPrismaRepository(prisma);

    await repo.markEmailVerified('u1', now);

    // Exactly one $transaction call wrapping both writes — if the process
    // crashes or the DB errors between them, Postgres rolls back the whole
    // pair, so a user can never be left emailVerifiedAt-stamped but still
    // `unverified` with no way to retrigger the tier grant.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(captured.userUpdate).toHaveBeenCalledTimes(1);
    expect(captured.userUpdateMany).toHaveBeenCalledTimes(1);
  });
});
