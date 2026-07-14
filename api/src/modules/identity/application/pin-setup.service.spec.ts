/**
 * Unit tests for PinSetupService — set a transaction PIN on a tier_1-or-above
 * (email-verified) user who has no PIN yet. Covers both the pre-KYC
 * onboarding-wizard path (tier_1, kycStatus not yet 'verified') and the
 * already-fully-verified recovery path.
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
    // Realistic default: email-verified (tier_1) but full KYC not yet done —
    // the onboarding-wizard scenario this service exists to unblock.
    kycStatus: 'not_started',
    kycTier: 'tier_1',
    simSwapDetectedAt: null,
    tierChangedAt: null,
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
  it('sets the PIN for a tier_1 (email-verified), PIN-less user pre-KYC and returns hasPin:true', async () => {
    const pinService = makePinService(false);
    const identityRepo = makeIdentityRepo(makeUser());
    const svc = new PinSetupService(pinService, identityRepo as never);

    const result = await svc.setTransactionPin(USER_ID, STRONG_PIN);

    expect(pinService.setPin).toHaveBeenCalledWith(USER_ID, STRONG_PIN);
    expect(result).toEqual({ hasPin: true });
  });

  it('sets the PIN for a fully KYC-verified (tier_2+) PIN-less user too', async () => {
    const pinService = makePinService(false);
    const identityRepo = makeIdentityRepo(
      makeUser({ kycStatus: 'verified', kycTier: 'tier_2' }),
    );
    const svc = new PinSetupService(pinService, identityRepo as never);

    const result = await svc.setTransactionPin(USER_ID, STRONG_PIN);

    expect(pinService.setPin).toHaveBeenCalledWith(USER_ID, STRONG_PIN);
    expect(result).toEqual({ hasPin: true });
  });

  it('throws PinSetupNotVerifiedError when the user is below tier_1 (unverified)', async () => {
    const pinService = makePinService(false);
    const identityRepo = makeIdentityRepo(makeUser({ kycTier: 'unverified' }));
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

  it('throws PinAlreadySetError when a tier_1 user already has a PIN (never overwrites)', async () => {
    const pinService = makePinService(true);
    const identityRepo = makeIdentityRepo(makeUser());
    const svc = new PinSetupService(pinService, identityRepo as never);

    await expect(
      svc.setTransactionPin(USER_ID, STRONG_PIN),
    ).rejects.toBeInstanceOf(PinAlreadySetError);
    expect(pinService.setPin).not.toHaveBeenCalled();
  });

  it('checks tier BEFORE checking for an existing PIN', async () => {
    const pinService = makePinService(true);
    const identityRepo = makeIdentityRepo(makeUser({ kycTier: 'unverified' }));
    const svc = new PinSetupService(pinService, identityRepo as never);

    await expect(
      svc.setTransactionPin(USER_ID, STRONG_PIN),
    ).rejects.toBeInstanceOf(PinSetupNotVerifiedError);
    // hasPin must not even be consulted when the user is below tier_1.
    expect(pinService.hasPin).not.toHaveBeenCalled();
  });
});
