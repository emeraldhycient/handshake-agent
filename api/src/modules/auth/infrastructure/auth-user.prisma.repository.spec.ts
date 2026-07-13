import { Prisma } from '../../../../generated/prisma/client';

import { AuthUserPrismaRepository } from './auth-user.prisma.repository';
import { DeviceAlreadyBoundError } from '../domain/auth-errors';
import type { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * Unit tests for AuthUserPrismaRepository.
 *
 * markEmailVerified — Task 2.1 (onboarding redesign): email verification now
 * grants kycTier=tier_1 + status=active, guarded so it only ever promotes a
 * fresh `unverified` user. No Nest TestingModule — the repository is
 * constructed directly with a faked PrismaService whose `$transaction` invokes
 * the callback with stub `tx` writers (mirrors kyc.prisma.repository.spec.ts).
 * Both writes run inside one interactive transaction so a crash/DB-error
 * between them can never leave emailVerifiedAt stamped without the tier grant
 * (or vice versa) — the `where: { kycTier: 'unverified' }` guard on the second
 * call is what makes the promotion atomic (no read-then-write race) and
 * non-downgrading; Prisma enforces it at the DB level (also exercised e2e).
 *
 * bindDevice — the shared device-bind choke point used by login/verify (and, by
 * user journey, sign-up → land-in-app). §3.4 pins one device per identity via
 * the UNIQUE `User.pinnedDeviceId`; re-binding a fingerprint already pinned to
 * ANOTHER user (a shared/re-used browser) hits a Prisma P2002 unique violation.
 * That must surface as a mapped domain error (→ 409), never as a raw Prisma
 * error that escapes to the global filter as an opaque 500.
 */

type UserUpdateArg = {
  where: { id: string };
  data: { emailVerifiedAt: Date };
};
type UserUpdateManyArg = {
  where: { id: string; kycTier: string; status: string };
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

  it('grants tier_1 + active status via a conditional write guarded to unverified, PROVISIONAL users only', async () => {
    const captured = freshCaptured();
    const repo = new AuthUserPrismaRepository(makePrisma(captured));

    await repo.markEmailVerified('u1', now);

    // The guard is the `where` clause itself — Prisma/Postgres evaluates it
    // atomically server-side, so a user already at tier_1/2/3 never matches and
    // is left untouched (no downgrade, no tierChangedAt re-stamp, §3.3). The
    // `status: 'provisional'` term is a security guard: it scopes the
    // `status: 'active'` promotion to a genuine fresh signup so completing email
    // verification can NEVER reactivate an operator-suspended/deactivated
    // (still-unverified) account as a side effect.
    expect(captured.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'u1', kycTier: 'unverified', status: 'provisional' },
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

function buildMockPrisma(
  overrides: {
    upsert?: jest.Mock;
    updateMany?: jest.Mock;
  } = {},
): PrismaService {
  return {
    device: {
      upsert:
        overrides.upsert ?? jest.fn().mockResolvedValue({ id: 'device-1' }),
    },
    user: {
      updateMany:
        overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
}

function p2002OnPinnedDevice(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`pinnedDeviceId`)',
    {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['pinnedDeviceId'] },
    },
  );
}

const input = {
  userId: 'user-b',
  fingerprint: 'fp-shared-browser',
  userAgent: 'jest',
  ip: '127.0.0.1',
};

describe('AuthUserPrismaRepository.bindDevice', () => {
  it('upserts the device and pins it only when no device is pinned yet, returning the id', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'device-1' });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repo = new AuthUserPrismaRepository(
      buildMockPrisma({ upsert, updateMany }),
    );

    const result = await repo.bindDevice(input);

    expect(result).toEqual({ deviceId: 'device-1' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fingerprint: 'fp-shared-browser' } }),
    );
    // Pin is guarded on pinnedDeviceId: null so it only sets on first bind.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'user-b', pinnedDeviceId: null },
      data: { pinnedDeviceId: 'device-1' },
    });
  });

  it('maps a P2002 pin collision (device already bound to another user) to DeviceAlreadyBoundError', async () => {
    const updateMany = jest.fn().mockRejectedValue(p2002OnPinnedDevice());
    const repo = new AuthUserPrismaRepository(buildMockPrisma({ updateMany }));

    await expect(repo.bindDevice(input)).rejects.toBeInstanceOf(
      DeviceAlreadyBoundError,
    );
  });

  it('re-throws a non-P2002 Prisma error unchanged (no over-broad swallowing)', async () => {
    const other = new Prisma.PrismaClientKnownRequestError('connection lost', {
      code: 'P1001',
      clientVersion: 'test',
    });
    const updateMany = jest.fn().mockRejectedValue(other);
    const repo = new AuthUserPrismaRepository(buildMockPrisma({ updateMany }));

    await expect(repo.bindDevice(input)).rejects.toBe(other);
  });

  it('re-throws a generic (non-Prisma) error unchanged', async () => {
    const boom = new Error('unexpected');
    const updateMany = jest.fn().mockRejectedValue(boom);
    const repo = new AuthUserPrismaRepository(buildMockPrisma({ updateMany }));

    await expect(repo.bindDevice(input)).rejects.toBe(boom);
  });
});
