/**
 * Unit tests for PinSetupService — set a transaction PIN on an already-verified
 * user who has no PIN yet (verified-but-PIN-less recovery).
 *
 * TDD: tests written RED first. PinService + IIdentityRepository are mocked;
 * the service is constructed directly (no Nest TestingModule).
 */

import type { PinService } from '../../../core/auth/pin.service';
import type {
  IIdentityRepository,
  UserRecord,
} from './ports/identity.repository.port';
import {
  PinAlreadySetError,
  PinSetupNotVerifiedError,
} from '../domain/pin-setup-errors';
import { PinSetupService } from './pin-setup.service';

const USER_ID = 'user-uuid-1';
const STRONG_PIN = '1357';

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    status: 'active',
    kycStatus: 'verified',
    kycTier: 'tier_1',
    simSwapDetectedAt: null,
    ...overrides,
  };
}

function makePinService(hasPin = false): jest.Mocked<PinService> {
  return {
    hasPin: jest.fn().mockResolvedValue(hasPin),
    setPin: jest.fn().mockResolvedValue(undefined),
    hashPin: jest.fn(),
    verifyPin: jest.fn(),
  } as unknown as jest.Mocked<PinService>;
}

function makeIdentityRepo(
  user: UserRecord | null,
): jest.Mocked<Pick<IIdentityRepository, 'loadUser'>> {
  return {
    loadUser: jest.fn().mockResolvedValue(user),
  };
}

describe('PinSetupService.setTransactionPin', () => {
  it('sets the PIN for a verified, PIN-less user and returns hasPin:true', async () => {
    const pinService = makePinService(false);
    const identityRepo = makeIdentityRepo(makeUser());
    const svc = new PinSetupService(pinService, identityRepo as never);

    const result = await svc.setTransactionPin(USER_ID, STRONG_PIN);

    expect(pinService.setPin).toHaveBeenCalledWith(USER_ID, STRONG_PIN);
    expect(result).toEqual({ hasPin: true });
  });

  it('throws PinSetupNotVerifiedError when the user is not verified', async () => {
    const pinService = makePinService(false);
    const identityRepo = makeIdentityRepo(
      makeUser({ kycStatus: 'not_started' }),
    );
    const svc = new PinSetupService(pinService, identityRepo as never);

    await expect(
      svc.setTransactionPin(USER_ID, STRONG_PIN),
    ).rejects.toBeInstanceOf(PinSetupNotVerifiedError);
    expect(pinService.setPin).not.toHaveBeenCalled();
  });

  it('throws PinSetupNotVerifiedError when the user does not exist', async () => {
    const pinService = makePinService(false);
    const identityRepo = makeIdentityRepo(null);
    const svc = new PinSetupService(pinService, identityRepo as never);

    await expect(
      svc.setTransactionPin(USER_ID, STRONG_PIN),
    ).rejects.toBeInstanceOf(PinSetupNotVerifiedError);
    expect(pinService.setPin).not.toHaveBeenCalled();
  });

  it('throws PinAlreadySetError when a PIN already exists (never overwrites)', async () => {
    const pinService = makePinService(true);
    const identityRepo = makeIdentityRepo(makeUser());
    const svc = new PinSetupService(pinService, identityRepo as never);

    await expect(
      svc.setTransactionPin(USER_ID, STRONG_PIN),
    ).rejects.toBeInstanceOf(PinAlreadySetError);
    expect(pinService.setPin).not.toHaveBeenCalled();
  });

  it('checks verification BEFORE checking for an existing PIN', async () => {
    const pinService = makePinService(true);
    const identityRepo = makeIdentityRepo(
      makeUser({ kycStatus: 'not_started' }),
    );
    const svc = new PinSetupService(pinService, identityRepo as never);

    await expect(
      svc.setTransactionPin(USER_ID, STRONG_PIN),
    ).rejects.toBeInstanceOf(PinSetupNotVerifiedError);
    // hasPin must not even be consulted when the user is unverified.
    expect(pinService.hasPin).not.toHaveBeenCalled();
  });
});
