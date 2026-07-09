import { NotFoundException } from '@nestjs/common';

import { PatNotFoundError } from '../domain/pat-errors';
import { PinLockedError } from '../../../core/auth/domain/pin-errors';
import type { PatService } from '../application/pat.service';
import type { AuthenticatedUser } from './jwt-auth.guard';
import { PatController } from './pat.controller';

const CURRENT_USER: AuthenticatedUser = {
  userId: 'u1',
  sessionId: 's1',
  deviceId: 'd1',
};

function makeController(overrides: Partial<PatService> = {}) {
  const svc = {
    mint: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
    ...overrides,
  };
  return { controller: new PatController(svc as unknown as PatService), svc };
}

describe('PatController', () => {
  it('POST /profile/tokens mints for the CURRENT user (never a body-supplied id)', async () => {
    const minted = {
      id: '018f6b3a-0000-7000-8000-000000000001',
      label: 'Claude',
      scopes: ['read'],
      token: `hsk_pat_${'ab'.repeat(32)}`,
      createdAt: '2026-07-08T10:00:00.000Z',
      expiresAt: null,
    };
    const { controller, svc } = makeController({
      mint: jest.fn().mockResolvedValue(minted),
    });

    const out = await controller.create(
      { label: 'Claude', pin: '8047', scopes: ['read'] } as never,
      CURRENT_USER,
    );
    expect(out).toEqual(minted);
    expect(svc.mint).toHaveBeenCalledWith({
      userId: 'u1',
      label: 'Claude',
      pin: '8047',
      scopes: ['read'],
      expiresInDays: undefined,
    });
  });

  it('lets PIN errors bubble to the global filter (existing pin mapping, e.g. PIN_LOCKED)', async () => {
    const { controller } = makeController({
      mint: jest
        .fn()
        .mockRejectedValue(
          new PinLockedError(new Date('2026-07-08T11:00:00Z')),
        ),
    });
    await expect(
      controller.create(
        { label: 'x', pin: '0000', scopes: ['read'] } as never,
        CURRENT_USER,
      ),
    ).rejects.toBeInstanceOf(PinLockedError);
  });

  it('GET /profile/tokens returns the masked list for the current user', async () => {
    const list = { tokens: [] };
    const { controller, svc } = makeController({
      list: jest.fn().mockResolvedValue(list),
    });
    await expect(controller.list(CURRENT_USER)).resolves.toEqual(list);
    expect(svc.list).toHaveBeenCalledWith('u1');
  });

  it('DELETE /profile/tokens/:id maps PatNotFoundError to 404 (foreign id never disclosed)', async () => {
    const { controller } = makeController({
      revoke: jest.fn().mockRejectedValue(new PatNotFoundError()),
    });
    await expect(
      controller.revoke('foreign-id', CURRENT_USER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DELETE /profile/tokens/:id resolves void on success (204)', async () => {
    const { controller, svc } = makeController({
      revoke: jest.fn().mockResolvedValue(undefined),
    });
    await expect(
      controller.revoke('pat-1', CURRENT_USER),
    ).resolves.toBeUndefined();
    expect(svc.revoke).toHaveBeenCalledWith('u1', 'pat-1');
  });
});
