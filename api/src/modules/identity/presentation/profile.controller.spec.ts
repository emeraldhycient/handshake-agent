import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PinLockedError } from '../../../core/auth/domain/pin-errors';
import {
  FiatCurrencyNotEnabledError,
  NameChangeNotAllowedError,
  ProfileSessionNotFoundError,
} from '../domain/profile-errors';
import type { ProfileService } from '../application/profile.service';
import type { ProfileSettingsService } from '../application/profile-settings.service';
import type { AuthenticatedUser } from '../../auth/presentation/jwt-auth.guard';
import { ProfileController } from './profile.controller';

const CURRENT_USER: AuthenticatedUser = {
  userId: 'u1',
  sessionId: 's1',
  deviceId: 'd1',
};

const PROFILE = {
  email: 'a@b.com',
  fullName: 'Amara Okeke',
  phone: '+2348011112222',
  kycStatus: 'verified',
  kycTier: 'tier_1',
  fiatCurrency: 'NGN',
  limits: null,
};

const NAME = { firstName: 'Amara', lastName: 'Okeke' };

function makeController(
  settingsOverrides: Partial<ProfileSettingsService> = {},
) {
  const profile = { getProfile: jest.fn().mockResolvedValue(PROFILE) };
  const settings = {
    changePin: jest.fn(),
    updateProfile: jest.fn().mockResolvedValue(PROFILE),
    setName: jest.fn().mockResolvedValue(NAME),
    listSessions: jest.fn().mockResolvedValue({ sessions: [] }),
    revokeSession: jest.fn(),
    ...settingsOverrides,
  };
  return {
    controller: new ProfileController(
      profile as unknown as ProfileService,
      settings as unknown as ProfileSettingsService,
    ),
    settings,
  };
}

describe('ProfileController.changePin', () => {
  it('delegates to the settings service for the CURRENT user (204 body-less)', async () => {
    const { controller, settings } = makeController();
    await expect(
      controller.changePin(
        { currentPin: '8047', newPin: '9152' },
        CURRENT_USER,
      ),
    ).resolves.toBeUndefined();
    expect(settings.changePin).toHaveBeenCalledWith('u1', '8047', '9152');
  });

  it('lets PIN errors bubble to the global filter (same shape as existing pin endpoints)', async () => {
    const { controller } = makeController({
      changePin: jest
        .fn()
        .mockRejectedValue(
          new PinLockedError(new Date('2026-07-08T11:00:00Z')),
        ),
    });
    await expect(
      controller.changePin({ currentPin: 'x', newPin: '9152' }, CURRENT_USER),
    ).rejects.toBeInstanceOf(PinLockedError);
  });
});

describe('ProfileController.update (PATCH /profile)', () => {
  it('returns the updated, schema-parsed ProfileResponse', async () => {
    const { controller, settings } = makeController();
    const out = await controller.update({ fiatCurrency: 'NGN' }, CURRENT_USER);
    expect(out).toEqual(PROFILE);
    expect(settings.updateProfile).toHaveBeenCalledWith('u1', {
      fiatCurrency: 'NGN',
    });
  });

  it('maps a non-enabled fiat to 422', async () => {
    const { controller } = makeController({
      updateProfile: jest
        .fn()
        .mockRejectedValue(new FiatCurrencyNotEnabledError('XOF')),
    });
    await expect(
      controller.update({ fiatCurrency: 'XOF' }, CURRENT_USER),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ProfileController.setName (POST /profile/name)', () => {
  it('delegates to the settings service for the CURRENT user and returns the persisted names', async () => {
    const { controller, settings } = makeController();
    const out = await controller.setName(NAME, CURRENT_USER);
    expect(out).toEqual(NAME);
    expect(settings.setName).toHaveBeenCalledWith('u1', NAME);
  });

  it('lets NameChangeNotAllowedError bubble to the global filter unchanged (409, no local catch)', async () => {
    const { controller } = makeController({
      setName: jest.fn().mockRejectedValue(new NameChangeNotAllowedError()),
    });
    await expect(controller.setName(NAME, CURRENT_USER)).rejects.toBeInstanceOf(
      NameChangeNotAllowedError,
    );
  });
});

describe('ProfileController sessions', () => {
  it('lists own sessions with the caller session id for the isCurrent flag', async () => {
    const { controller, settings } = makeController();
    await expect(controller.sessions(CURRENT_USER)).resolves.toEqual({
      sessions: [],
    });
    expect(settings.listSessions).toHaveBeenCalledWith('u1', 's1');
  });

  it('DELETE maps a foreign/unknown session to 404', async () => {
    const { controller } = makeController({
      revokeSession: jest
        .fn()
        .mockRejectedValue(new ProfileSessionNotFoundError()),
    });
    await expect(
      controller.revokeSession('foreign', CURRENT_USER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DELETE resolves void on success (204) — revoking the current session is allowed', async () => {
    const { controller, settings } = makeController();
    await expect(
      controller.revokeSession('s1', CURRENT_USER),
    ).resolves.toBeUndefined();
    expect(settings.revokeSession).toHaveBeenCalledWith('u1', 's1');
  });
});
