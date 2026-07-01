/**
 * Unit tests for PinService (task 4.3).
 *
 * PIN_REPOSITORY is mocked; CLOCK is a fixed stub; ConfigService is a stub.
 * No Nest TestingModule needed — PinService is constructed directly.
 *
 * TDD: tests were written RED first, then the implementation made them GREEN.
 */

import { ConfigService } from '@nestjs/config';

import type { Clock } from '../common/clock';
import type { IPinRepository, PinState } from './ports/pin.repository.port';
import {
  PinInvalidError,
  PinLockedError,
  PinNotSetError,
  WeakPinError,
} from './domain/pin-errors';
import { PinService } from './pin.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const LOCKOUT_MS = LOCKOUT_MINUTES * 60 * 1000;
const SCRYPT_KEY_LEN = 64;

const FIXED_NOW = new Date('2024-01-15T12:00:00.000Z');

/** Creates a stub ConfigService that returns the test auth.pin config. */
function makeConfigService(): ConfigService {
  return {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        'auth.pin.maxAttempts': MAX_ATTEMPTS,
        'auth.pin.lockoutMinutes': LOCKOUT_MINUTES,
        'auth.pin.scryptKeyLen': SCRYPT_KEY_LEN,
      };
      return map[key];
    },
  } as unknown as ConfigService;
}

/** Creates a fixed clock returning FIXED_NOW. */
function makeClock(): Clock {
  return { now: () => FIXED_NOW };
}

/** Creates a mock IPinRepository with jest.fn() for each method. */
function makeRepo(initialState?: PinState | null): {
  repo: jest.Mocked<IPinRepository>;
  state: { current: PinState | null };
} {
  const state = { current: initialState ?? null };

  // Use jest.fn() + mockImplementation to avoid triggering no-unused-vars for
  // the discarded userId parameter on methods that only use pinHash/count.
  const repo = {
    getPinState: jest
      .fn()
      .mockImplementation(() => Promise.resolve(state.current)),
    setPinHash: jest
      .fn()
      .mockImplementation((_uid: string, pinHash: string) => {
        if (state.current) {
          state.current = { ...state.current, pinHash };
        } else {
          state.current = { pinHash, pinFailureCount: 0, pinLockedUntil: null };
        }
        return Promise.resolve();
      }),
    recordFailure: jest
      .fn()
      .mockImplementation(
        (_uid: string, count: number, lockedUntil: Date | null) => {
          if (state.current) {
            state.current = {
              ...state.current,
              pinFailureCount: count,
              pinLockedUntil: lockedUntil,
            };
          }
          return Promise.resolve();
        },
      ),
    resetFailures: jest.fn().mockImplementation(() => {
      if (state.current) {
        state.current = {
          ...state.current,
          pinFailureCount: 0,
          pinLockedUntil: null,
        };
      }
      return Promise.resolve();
    }),
    clearPin: jest.fn().mockImplementation(() => {
      state.current = state.current
        ? { pinHash: null, pinFailureCount: 0, pinLockedUntil: null }
        : null;
      return Promise.resolve();
    }),
  } as jest.Mocked<IPinRepository>;

  return { repo, state };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PinService', () => {
  const USER_ID = 'user-uuid-1';

  // ── hashPin / verifyPin round-trip ────────────────────────────────────────

  it('hashPin produces a string and verifyPin with the SAME pin resolves', async () => {
    const { repo } = makeRepo();
    const svc = new PinService(repo, makeConfigService(), makeClock());

    const hash = await svc.hashPin('1357');
    expect(typeof hash).toBe('string');
    // Formatted as <saltHex>:<hashHex>
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);

    // Set up the repo state with the produced hash
    const { repo: repoWithPin } = makeRepo({
      pinHash: hash,
      pinFailureCount: 0,
      pinLockedUntil: null,
    });
    const svc2 = new PinService(repoWithPin, makeConfigService(), makeClock());

    await expect(svc2.verifyPin(USER_ID, '1357')).resolves.toBeUndefined();
  });

  it('verifyPin throws PinInvalidError when a DIFFERENT pin is supplied', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await svc.hashPin('1357');

    const { repo: repoWithPin } = makeRepo({
      pinHash: hash,
      pinFailureCount: 0,
      pinLockedUntil: null,
    });
    const svc2 = new PinService(repoWithPin, makeConfigService(), makeClock());

    // 2468 is a different (also strong) PIN — verify must reject the mismatch.
    await expect(svc2.verifyPin(USER_ID, '2468')).rejects.toBeInstanceOf(
      PinInvalidError,
    );
  });

  // ── PinNotSetError ────────────────────────────────────────────────────────

  it('verifyPin throws PinNotSetError when the user has no state', async () => {
    const { repo } = makeRepo(null); // null = no record at all
    const svc = new PinService(repo, makeConfigService(), makeClock());

    await expect(svc.verifyPin(USER_ID, '1234')).rejects.toBeInstanceOf(
      PinNotSetError,
    );
  });

  it('verifyPin throws PinNotSetError when pinHash is null', async () => {
    const { repo } = makeRepo({
      pinHash: null,
      pinFailureCount: 0,
      pinLockedUntil: null,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());

    await expect(svc.verifyPin(USER_ID, '1234')).rejects.toBeInstanceOf(
      PinNotSetError,
    );
  });

  // ── PinLockedError ────────────────────────────────────────────────────────

  it('verifyPin throws PinLockedError immediately when pinLockedUntil is in the future', async () => {
    const lockedUntil = new Date(FIXED_NOW.getTime() + 5 * 60 * 1000); // 5 min ahead
    const { repo } = makeRepo({
      pinHash: 'aabbcc:ddeeff', // value doesn't matter — lock is checked first
      pinFailureCount: MAX_ATTEMPTS,
      pinLockedUntil: lockedUntil,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());

    await expect(svc.verifyPin(USER_ID, '1234')).rejects.toBeInstanceOf(
      PinLockedError,
    );
    // Must NOT attempt to compare the PIN when locked
    expect(repo.recordFailure).not.toHaveBeenCalled();
  });

  // ── Failure counting below maxAttempts ────────────────────────────────────

  it('wrong pin below maxAttempts: increments failure count (lockedUntil null) and throws PinInvalidError', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await svc.hashPin('1357');

    const { repo, state } = makeRepo({
      pinHash: hash,
      pinFailureCount: 2,
      pinLockedUntil: null,
    });
    const svc2 = new PinService(repo, makeConfigService(), makeClock());

    await expect(svc2.verifyPin(USER_ID, 'wrong')).rejects.toBeInstanceOf(
      PinInvalidError,
    );

    expect(repo.recordFailure).toHaveBeenCalledTimes(1);
    const [calledUserId, calledCount, calledLockedUntil] =
      repo.recordFailure.mock.calls[0];
    expect(calledUserId).toBe(USER_ID);
    expect(calledCount).toBe(3); // 2 prior + 1 new
    expect(calledLockedUntil).toBeNull(); // not yet at maxAttempts
    void state;
  });

  // ── Failure counting reaching maxAttempts ─────────────────────────────────

  it('wrong pin reaching maxAttempts: records failure WITH lockedUntil set and throws PinInvalidError', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await svc.hashPin('1357');

    // pinFailureCount = 4, so this attempt makes it 5 (= maxAttempts)
    const { repo } = makeRepo({
      pinHash: hash,
      pinFailureCount: 4,
      pinLockedUntil: null,
    });
    const svc2 = new PinService(repo, makeConfigService(), makeClock());

    await expect(svc2.verifyPin(USER_ID, 'wrong')).rejects.toBeInstanceOf(
      PinInvalidError,
    );

    expect(repo.recordFailure).toHaveBeenCalledTimes(1);
    const [, calledCount, calledLockedUntil] = repo.recordFailure.mock.calls[0];
    expect(calledCount).toBe(MAX_ATTEMPTS); // 5
    // lockedUntil must be now + lockoutMs
    expect(calledLockedUntil).toBeInstanceOf(Date);
    const expectedLockout = new Date(FIXED_NOW.getTime() + LOCKOUT_MS);
    expect((calledLockedUntil as Date).getTime()).toBe(
      expectedLockout.getTime(),
    );
  });

  // ── Reset on success after prior failures ─────────────────────────────────

  it('correct pin after prior failures calls resetFailures', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await svc.hashPin('1357');

    const { repo } = makeRepo({
      pinHash: hash,
      pinFailureCount: 2,
      pinLockedUntil: null,
    });
    const svc2 = new PinService(repo, makeConfigService(), makeClock());

    await expect(svc2.verifyPin(USER_ID, '1357')).resolves.toBeUndefined();
    expect(repo.resetFailures).toHaveBeenCalledWith(USER_ID);
    expect(repo.recordFailure).not.toHaveBeenCalled();
  });

  // ── Server-side PIN strength (CLAUDE.md §3.3) ─────────────────────────────
  // The server is the security boundary: a weak PIN must be rejected even when
  // a non-web caller bypasses the shared TransactionPinSchema on the client.

  it('hashPin rejects a 1-digit PIN with WeakPinError', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    await expect(svc.hashPin('1')).rejects.toBeInstanceOf(WeakPinError);
  });

  it('hashPin rejects a non-numeric PIN with WeakPinError', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    await expect(svc.hashPin('abcd')).rejects.toBeInstanceOf(WeakPinError);
  });

  it('hashPin rejects an all-same-digit PIN with WeakPinError', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    await expect(svc.hashPin('0000')).rejects.toBeInstanceOf(WeakPinError);
  });

  it('hashPin rejects a trivial sequence with WeakPinError', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    await expect(svc.hashPin('1234')).rejects.toBeInstanceOf(WeakPinError);
    await expect(svc.hashPin('4321')).rejects.toBeInstanceOf(WeakPinError);
  });

  it('hashPin accepts a strong 4–6 digit PIN', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    await expect(svc.hashPin('1357')).resolves.toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    await expect(svc.hashPin('135790')).resolves.toMatch(
      /^[0-9a-f]+:[0-9a-f]+$/,
    );
  });

  it('setPin rejects a weak PIN with WeakPinError and never persists', async () => {
    const { repo } = makeRepo();
    const svc = new PinService(repo, makeConfigService(), makeClock());
    await expect(svc.setPin(USER_ID, '1111')).rejects.toBeInstanceOf(
      WeakPinError,
    );
    expect(repo.setPinHash).not.toHaveBeenCalled();
    expect(repo.resetFailures).not.toHaveBeenCalled();
  });

  it('WeakPinError has code PIN_WEAK', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const err = await svc.hashPin('1').catch((e: unknown) => e);
    expect((err as WeakPinError).code).toBe('PIN_WEAK');
  });

  // ── hasPin ────────────────────────────────────────────────────────────────

  it('hasPin returns false when no PIN state exists', async () => {
    const { repo } = makeRepo(null);
    const svc = new PinService(repo, makeConfigService(), makeClock());
    await expect(svc.hasPin(USER_ID)).resolves.toBe(false);
  });

  it('hasPin returns false when pinHash is null', async () => {
    const { repo } = makeRepo({
      pinHash: null,
      pinFailureCount: 0,
      pinLockedUntil: null,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());
    await expect(svc.hasPin(USER_ID)).resolves.toBe(false);
  });

  it('hasPin returns true when a pinHash is present', async () => {
    const { repo } = makeRepo({
      pinHash: 'aabb:ccdd',
      pinFailureCount: 0,
      pinLockedUntil: null,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());
    await expect(svc.hasPin(USER_ID)).resolves.toBe(true);
  });

  // ── setPin ────────────────────────────────────────────────────────────────

  it('setPin calls setPinHash and resetFailures', async () => {
    const { repo } = makeRepo();
    const svc = new PinService(repo, makeConfigService(), makeClock());

    await svc.setPin(USER_ID, '5681');

    expect(repo.setPinHash).toHaveBeenCalledTimes(1);
    const [calledUserId, calledHash] = repo.setPinHash.mock.calls[0];
    expect(calledUserId).toBe(USER_ID);
    expect(typeof calledHash).toBe('string');
    // Hash format
    expect(calledHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(repo.resetFailures).toHaveBeenCalledWith(USER_ID);
  });

  // ── Error codes ───────────────────────────────────────────────────────────

  it('PinNotSetError has code PIN_NOT_SET', async () => {
    const { repo } = makeRepo(null);
    const svc = new PinService(repo, makeConfigService(), makeClock());
    const err = await svc.verifyPin(USER_ID, '1234').catch((e: unknown) => e);
    expect((err as PinNotSetError).code).toBe('PIN_NOT_SET');
  });

  it('PinLockedError has code PIN_LOCKED', async () => {
    const lockedUntil = new Date(FIXED_NOW.getTime() + 60_000);
    const { repo } = makeRepo({
      pinHash: 'aabb:ccdd',
      pinFailureCount: MAX_ATTEMPTS,
      pinLockedUntil: lockedUntil,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());
    const err = await svc.verifyPin(USER_ID, '1234').catch((e: unknown) => e);
    expect((err as PinLockedError).code).toBe('PIN_LOCKED');
  });

  it('PinInvalidError has code PIN_INVALID', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await svc.hashPin('2468');
    const { repo } = makeRepo({
      pinHash: hash,
      pinFailureCount: 0,
      pinLockedUntil: null,
    });
    const svc2 = new PinService(repo, makeConfigService(), makeClock());
    const err = await svc2.verifyPin(USER_ID, 'wrong').catch((e: unknown) => e);
    expect((err as PinInvalidError).code).toBe('PIN_INVALID');
  });
});
