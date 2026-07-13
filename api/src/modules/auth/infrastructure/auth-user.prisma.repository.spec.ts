import { Prisma } from '../../../../generated/prisma/client';

import { AuthUserPrismaRepository } from './auth-user.prisma.repository';
import { DeviceAlreadyBoundError } from '../domain/auth-errors';
import type { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * Unit tests for AuthUserPrismaRepository.bindDevice — the shared device-bind
 * choke point used by login/verify (and, by user journey, sign-up → land-in-app).
 *
 * §3.4 pins one device per identity: `User.pinnedDeviceId` is a UNIQUE column.
 * When a device fingerprint already pinned to ANOTHER user is re-bound (a shared
 * or re-used browser), the pin write hits a Prisma P2002 unique violation. That
 * must surface as a mapped domain error (→ 409), never as a raw Prisma error that
 * escapes to the global filter as an opaque 500.
 */
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
