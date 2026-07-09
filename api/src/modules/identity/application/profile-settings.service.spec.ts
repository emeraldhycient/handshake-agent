import {
  PinInvalidError,
  PinLockedError,
} from '../../../core/auth/domain/pin-errors';
import type { PinService } from '../../../core/auth/pin.service';
import {
  FiatCurrencyNotEnabledError,
  ProfileSessionNotFoundError,
} from '../domain/profile-errors';
import type {
  IProfileSessionRepository,
  ProfileSessionRecord,
} from './ports/profile-session.repository.port';
import type { ProfileService } from './profile.service';
import { ProfileSettingsService } from './profile-settings.service';

const PROFILE = {
  email: 'a@b.com',
  fullName: 'Amara Okeke',
  phone: '+2348011112222',
  kycStatus: 'verified',
  kycTier: 'tier_1',
  fiatCurrency: 'NGN',
  limits: null,
};

function makeService(
  overrides: {
    verifyPin?: jest.Mock;
    setPin?: jest.Mock;
    updateProfileSettings?: jest.Mock;
    isCurrencyLive?: (code: string) => boolean;
    sessions?: Partial<IProfileSessionRepository>;
  } = {},
) {
  const pin = {
    verifyPin: overrides.verifyPin ?? jest.fn(),
    setPin: overrides.setPin ?? jest.fn(),
  };
  const identity = {
    updateProfileSettings:
      overrides.updateProfileSettings ?? jest.fn().mockResolvedValue(undefined),
  };
  const sessionRepo: IProfileSessionRepository = {
    listActiveForUser: jest.fn().mockResolvedValue([]),
    revokeOwn: jest.fn().mockResolvedValue(true),
    ...overrides.sessions,
  };
  const registry = {
    isCurrencyLive:
      overrides.isCurrencyLive ?? ((code: string) => code === 'NGN'),
  };
  const profile = { getProfile: jest.fn().mockResolvedValue(PROFILE) };
  const svc = new ProfileSettingsService(
    pin as unknown as PinService,
    identity as never,
    sessionRepo,
    registry as never,
    profile as unknown as ProfileService,
  );
  return { svc, pin, identity, sessionRepo, profile };
}

describe('ProfileSettingsService.changePin', () => {
  it('verifies the CURRENT pin through the lockout gate BEFORE setting the new one', async () => {
    const order: string[] = [];
    const verifyPin = jest.fn(() => {
      order.push('verify');
      return Promise.resolve();
    });
    const setPin = jest.fn(() => {
      order.push('set');
      return Promise.resolve();
    });
    const { svc } = makeService({ verifyPin, setPin });

    await svc.changePin('u1', '8047', '9152');

    expect(verifyPin).toHaveBeenCalledWith('u1', '8047');
    expect(setPin).toHaveBeenCalledWith('u1', '9152');
    expect(order).toEqual(['verify', 'set']);
  });

  it('propagates lockout/invalid errors untouched and never sets the new PIN', async () => {
    const setPin = jest.fn();
    const locked = makeService({
      verifyPin: jest
        .fn()
        .mockRejectedValue(
          new PinLockedError(new Date('2026-07-08T11:00:00Z')),
        ),
      setPin,
    });
    await expect(
      locked.svc.changePin('u1', 'x', '9152'),
    ).rejects.toBeInstanceOf(PinLockedError);

    const wrong = makeService({
      verifyPin: jest.fn().mockRejectedValue(new PinInvalidError(2)),
      setPin,
    });
    await expect(wrong.svc.changePin('u1', 'x', '9152')).rejects.toBeInstanceOf(
      PinInvalidError,
    );
    expect(setPin).not.toHaveBeenCalled();
  });
});

describe('ProfileSettingsService.updateProfile', () => {
  it('persists phone and preferred fiat and returns the fresh profile', async () => {
    const updateProfileSettings = jest.fn().mockResolvedValue(undefined);
    const { svc, profile } = makeService({ updateProfileSettings });

    const out = await svc.updateProfile('u1', {
      phone: '+2348011112222',
      fiatCurrency: 'NGN',
    });

    expect(updateProfileSettings).toHaveBeenCalledWith('u1', {
      profilePhone: '+2348011112222',
      preferredFiatCurrency: 'NGN',
    });
    expect(profile.getProfile).toHaveBeenCalledWith('u1');
    expect(out).toEqual(PROFILE);
  });

  it('supports partial updates (only the provided field is written)', async () => {
    const updateProfileSettings = jest.fn().mockResolvedValue(undefined);
    const { svc } = makeService({ updateProfileSettings });

    await svc.updateProfile('u1', { phone: '08011112222' });
    expect(updateProfileSettings).toHaveBeenCalledWith('u1', {
      profilePhone: '08011112222',
    });
  });

  it('rejects a non-live fiat FAIL-CLOSED before any write (§3.3)', async () => {
    const updateProfileSettings = jest.fn();
    const { svc } = makeService({
      updateProfileSettings,
      isCurrencyLive: () => false,
    });

    await expect(
      svc.updateProfile('u1', { fiatCurrency: 'GHS' }),
    ).rejects.toBeInstanceOf(FiatCurrencyNotEnabledError);
    expect(updateProfileSettings).not.toHaveBeenCalled();
  });
});

describe('ProfileSettingsService.listSessions', () => {
  const rows: ProfileSessionRecord[] = [
    {
      id: 's2',
      channel: 'web',
      userAgent: 'Chrome',
      issuedAt: new Date('2026-07-08T09:00:00.000Z'),
      lastActivityAt: new Date('2026-07-08T09:30:00.000Z'),
      expiresAt: new Date('2026-07-09T09:00:00.000Z'),
    },
    {
      id: 's1',
      channel: 'web',
      userAgent: null,
      issuedAt: new Date('2026-07-07T09:00:00.000Z'),
      lastActivityAt: null,
      expiresAt: new Date('2026-07-08T22:00:00.000Z'),
    },
  ];

  it('maps rows to the contract shape and flags the CURRENT session first', async () => {
    const { svc } = makeService({
      sessions: { listActiveForUser: jest.fn().mockResolvedValue(rows) },
    });

    const out = await svc.listSessions('u1', 's1');
    expect(out.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(out.sessions[0]).toEqual({
      id: 's1',
      channel: 'web',
      userAgent: null,
      createdAt: '2026-07-07T09:00:00.000Z',
      lastUsedAt: null,
      expiresAt: '2026-07-08T22:00:00.000Z',
      isCurrent: true,
    });
    expect(out.sessions[1].isCurrent).toBe(false);
    expect(out.sessions[1].lastUsedAt).toBe('2026-07-08T09:30:00.000Z');
  });
});

describe('ProfileSettingsService.revokeSession', () => {
  it('revokes an owned session (including the current one — behaves like logout)', async () => {
    const revokeOwn = jest.fn().mockResolvedValue(true);
    const { svc } = makeService({ sessions: { revokeOwn } });

    await expect(svc.revokeSession('u1', 's1')).resolves.toBeUndefined();
    expect(revokeOwn).toHaveBeenCalledWith(
      'u1',
      's1',
      expect.any(Date),
      expect.any(String),
    );
  });

  it('fails closed with not-found for a foreign/unknown session id', async () => {
    const { svc } = makeService({
      sessions: { revokeOwn: jest.fn().mockResolvedValue(false) },
    });
    await expect(svc.revokeSession('u1', 'foreign')).rejects.toBeInstanceOf(
      ProfileSessionNotFoundError,
    );
  });
});
