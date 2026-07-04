/**
 * Unit tests for PinService (task 4.3).
 *
 * PIN_REPOSITORY is mocked; CLOCK is a fixed stub; ConfigService is a stub.
 * No Nest TestingModule needed — PinService is constructed directly.
 *
 * TDD: tests were written RED first, then the implementation made them GREEN.
 *
 * The failure counter in the fake repo is a REAL atomic counter (mutated
 * synchronously per call), mirroring the Prisma `{ increment: 1 }` semantics.
 * This is what lets the concurrency test prove the TOCTOU brute-force fix:
 * even under a simultaneous burst, at most `maxAttempts` calls reach the
 * scrypt comparison and the account ends locked.
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
function makeClock(nowValue: Date = FIXED_NOW): Clock {
  return { now: () => nowValue };
}

/**
 * Creates a mock IPinRepository backed by an in-memory state object.
 *
 * `registerFailedAttempt` is a REAL atomic operation: it folds the expired-
 * window reset INTO the increment and mutates the shared state synchronously,
 * exactly as the production single-statement UPDATE does at the DB. This is
 * essential — a fake that reset-then-incremented across an await would NOT model
 * the atomicity the production repo guarantees, and the concurrency test (esp.
 * the just-expired-window burst) would give a false pass.
 */
function makeRepo(initialState?: PinState | null): {
  repo: jest.Mocked<IPinRepository>;
  state: { current: PinState | null };
} {
  const state = { current: initialState ?? null };

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
    // Atomic: fold the expired-window reset INTO the increment (exactly as the
    // production single-statement UPDATE does) and return the resulting state.
    registerFailedAttempt: jest
      .fn()
      .mockImplementation((_uid: string, now: Date) => {
        const cur = state.current;
        if (!cur) return Promise.resolve({ count: 0, lockedUntil: null });
        let count: number;
        let lockedUntil: Date | null;
        if (cur.pinLockedUntil && cur.pinLockedUntil > now) {
          // Active lock: leave the counter untouched.
          count = cur.pinFailureCount;
          lockedUntil = cur.pinLockedUntil;
        } else if (cur.pinLockedUntil && cur.pinLockedUntil <= now) {
          // Expired window: start a fresh window at 1 and clear the lock.
          count = 1;
          lockedUntil = null;
        } else {
          count = cur.pinFailureCount + 1;
          lockedUntil = null;
        }
        state.current = {
          ...cur,
          pinFailureCount: count,
          pinLockedUntil: lockedUntil,
        };
        return Promise.resolve({ count, lockedUntil });
      }),
    setLock: jest.fn().mockImplementation((_uid: string, lockedUntil: Date) => {
      if (state.current) {
        state.current = { ...state.current, pinLockedUntil: lockedUntil };
      }
      return Promise.resolve();
    }),
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
    // Must NOT attempt to compare the PIN when locked — no register, no lock write.
    expect(repo.registerFailedAttempt).not.toHaveBeenCalled();
    expect(repo.setLock).not.toHaveBeenCalled();
  });

  // ── Failure counting below maxAttempts ────────────────────────────────────

  it('wrong pin below maxAttempts: atomically increments (no lock) and throws PinInvalidError', async () => {
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

    // Counter advanced atomically to 3; not yet at maxAttempts, so no lock.
    expect(repo.registerFailedAttempt).toHaveBeenCalledTimes(1);
    expect(repo.registerFailedAttempt).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Date),
    );
    expect(repo.setLock).not.toHaveBeenCalled();
    expect(state.current!.pinFailureCount).toBe(3); // 2 prior + 1 new
    expect(state.current!.pinLockedUntil).toBeNull();
  });

  it('wrong pin below maxAttempts reports the correct remaining attempts', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await svc.hashPin('1357');

    // count goes 2 → 3; remaining = maxAttempts(5) - 3 = 2
    const { repo } = makeRepo({
      pinHash: hash,
      pinFailureCount: 2,
      pinLockedUntil: null,
    });
    const svc2 = new PinService(repo, makeConfigService(), makeClock());

    const err: unknown = await svc2
      .verifyPin(USER_ID, 'wrong')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PinInvalidError);
    expect((err as PinInvalidError).message).toContain('2 attempts remaining');
  });

  // ── Failure counting reaching maxAttempts ─────────────────────────────────

  it('wrong pin reaching maxAttempts: sets the lock and throws PinInvalidError', async () => {
    const svc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await svc.hashPin('1357');

    // pinFailureCount = 4, so this attempt makes it 5 (= maxAttempts)
    const { repo, state } = makeRepo({
      pinHash: hash,
      pinFailureCount: 4,
      pinLockedUntil: null,
    });
    const svc2 = new PinService(repo, makeConfigService(), makeClock());

    await expect(svc2.verifyPin(USER_ID, 'wrong')).rejects.toBeInstanceOf(
      PinInvalidError,
    );

    expect(repo.registerFailedAttempt).toHaveBeenCalledTimes(1);
    expect(repo.setLock).toHaveBeenCalledTimes(1);
    const [lockUser, lockedUntil] = repo.setLock.mock.calls[0];
    expect(lockUser).toBe(USER_ID);
    // lockedUntil must be now + lockoutMs
    const expectedLockout = new Date(FIXED_NOW.getTime() + LOCKOUT_MS);
    expect(lockedUntil.getTime()).toBe(expectedLockout.getTime());
    expect(state.current!.pinLockedUntil!.getTime()).toBe(
      expectedLockout.getTime(),
    );
  });

  // ── Lockout window expiry → fresh window (do NOT permanently lock out) ─────

  it('re-entry works after the lockout window expires with the correct PIN', async () => {
    // Build a valid hash for the correct PIN.
    const hashSvc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await hashSvc.hashPin('1357');

    // Account was locked, but the lock timestamp is now in the PAST.
    const pastLock = new Date(FIXED_NOW.getTime() - 60_000);
    const { repo, state } = makeRepo({
      pinHash: hash,
      pinFailureCount: MAX_ATTEMPTS,
      pinLockedUntil: pastLock,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());

    // The correct PIN, after the window expired, must succeed.
    await expect(svc.verifyPin(USER_ID, '1357')).resolves.toBeUndefined();

    // The expired window is folded into the atomic register (fresh count of 1),
    // then cleared by resetFailures on the successful compare.
    expect(repo.resetFailures).toHaveBeenCalledWith(USER_ID);
    expect(repo.setLock).not.toHaveBeenCalled();
    expect(state.current!.pinFailureCount).toBe(0);
    expect(state.current!.pinLockedUntil).toBeNull();
  });

  it('wrong pin after an expired lockout window starts a fresh count (not immediately re-locked)', async () => {
    const hashSvc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await hashSvc.hashPin('1357');

    const pastLock = new Date(FIXED_NOW.getTime() - 60_000);
    const { repo, state } = makeRepo({
      pinHash: hash,
      pinFailureCount: MAX_ATTEMPTS,
      pinLockedUntil: pastLock,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());

    // A wrong PIN after expiry: the atomic register starts a fresh window at 1
    // (folded reset+increment) — NOT re-locked, and no separate resetFailures.
    await expect(svc.verifyPin(USER_ID, 'wrong')).rejects.toBeInstanceOf(
      PinInvalidError,
    );
    expect(repo.registerFailedAttempt).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Date),
    );
    expect(repo.resetFailures).not.toHaveBeenCalled();
    expect(state.current!.pinFailureCount).toBe(1);
    expect(state.current!.pinLockedUntil).toBeNull();
    expect(repo.setLock).not.toHaveBeenCalled();
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
    expect(repo.setLock).not.toHaveBeenCalled();
  });

  // ── Sequential lockout: locks after maxAttempts consecutive failures ──────

  it('locks after maxAttempts sequential wrong-PIN attempts (subsequent attempts are PinLocked)', async () => {
    const hashSvc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await hashSvc.hashPin('1357');

    const { repo, state } = makeRepo({
      pinHash: hash,
      pinFailureCount: 0,
      pinLockedUntil: null,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());

    // First MAX_ATTEMPTS wrong guesses reach the compare and reject as INVALID.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await expect(svc.verifyPin(USER_ID, 'wrong')).rejects.toBeInstanceOf(
        PinInvalidError,
      );
    }

    // The lock was set exactly once (on the maxAttempts-th failure).
    expect(repo.setLock).toHaveBeenCalledTimes(1);
    expect(state.current!.pinLockedUntil).not.toBeNull();

    // The (MAX_ATTEMPTS + 1)-th attempt is now rejected as LOCKED, not INVALID,
    // and must NOT run scrypt / register another attempt.
    const incBefore = repo.registerFailedAttempt.mock.calls.length;
    await expect(svc.verifyPin(USER_ID, '1357')).rejects.toBeInstanceOf(
      PinLockedError,
    );
    expect(repo.registerFailedAttempt.mock.calls.length).toBe(incBefore);
  });

  // ── CONCURRENCY: the lockout must hold under a simultaneous burst ─────────
  // This is the regression test for the TOCTOU brute-force bypass. Against the
  // OLD implementation (read count → +1 in the service → setter write), every
  // concurrent call read pinFailureCount=0 and wrote 1, so the counter never
  // advanced and ALL 20 guesses reached the compare (lockout bypassed). With
  // the atomic increment-BEFORE-compare, at most maxAttempts reach the compare
  // and the account ends locked.

  it('caps concurrent wrong-PIN attempts at maxAttempts comparisons and ends LOCKED', async () => {
    const hashSvc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await hashSvc.hashPin('1357');

    const { repo, state } = makeRepo({
      pinHash: hash,
      pinFailureCount: 0,
      pinLockedUntil: null,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());

    const BURST = 20;
    const results = await Promise.allSettled(
      Array.from({ length: BURST }, () => svc.verifyPin(USER_ID, 'wrong')),
    );

    // Every attempt was rejected (wrong PIN).
    expect(results.every((r) => r.status === 'rejected')).toBe(true);

    const reasons = results.map(
      (r) => (r as PromiseRejectedResult).reason as Error,
    );
    const invalid = reasons.filter((e) => e instanceof PinInvalidError);
    const locked = reasons.filter((e) => e instanceof PinLockedError);

    // At most maxAttempts reached the scrypt comparison (PinInvalidError);
    // the rest were short-circuited by the lock (PinLockedError).
    expect(invalid.length).toBeLessThanOrEqual(MAX_ATTEMPTS);
    // And every rejection is accounted for as either invalid or locked.
    expect(invalid.length + locked.length).toBe(BURST);
    // Some attempts must have been blocked by the lock (burst > maxAttempts).
    expect(locked.length).toBeGreaterThanOrEqual(BURST - MAX_ATTEMPTS);

    // The account is LOCKED afterwards.
    expect(state.current!.pinLockedUntil).not.toBeNull();
    expect(repo.setLock).toHaveBeenCalled();
  });

  // Regression for the EXPIRED-lockout-window path. An account that previously
  // hit the lock and waited out the window (pinLockedUntil in the PAST, counter
  // still at maxAttempts) is an attacker-inducible state. A fix that reset the
  // counter in a SEPARATE statement before incrementing would let a concurrent
  // burst interleave the reset and keep every guess under the cap — the same
  // TOCTOU bypass, merely gated behind one elapsed lockout. The single atomic
  // registerFailedAttempt (expired-window reset folded INTO the increment) must
  // still cap the burst at maxAttempts comparisons.
  it('caps a concurrent burst on a just-EXPIRED lockout window at maxAttempts', async () => {
    const hashSvc = new PinService(
      makeRepo().repo,
      makeConfigService(),
      makeClock(),
    );
    const hash = await hashSvc.hashPin('1357');

    const expiredLock = new Date(FIXED_NOW.getTime() - 1000); // window elapsed
    const { repo, state } = makeRepo({
      pinHash: hash,
      pinFailureCount: MAX_ATTEMPTS,
      pinLockedUntil: expiredLock,
    });
    const svc = new PinService(repo, makeConfigService(), makeClock());

    const BURST = 20;
    const results = await Promise.allSettled(
      Array.from({ length: BURST }, () => svc.verifyPin(USER_ID, 'wrong')),
    );

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const reasons = results.map(
      (r) => (r as PromiseRejectedResult).reason as Error,
    );
    const invalid = reasons.filter((e) => e instanceof PinInvalidError);
    const locked = reasons.filter((e) => e instanceof PinLockedError);

    // The fresh window still caps comparisons at maxAttempts — the expired-window
    // reset did NOT reopen the bypass.
    expect(invalid.length).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(invalid.length + locked.length).toBe(BURST);
    // And the account is LOCKED again (a future window) afterwards.
    expect(state.current!.pinLockedUntil).not.toBeNull();
    expect(state.current!.pinLockedUntil!.getTime()).toBeGreaterThan(
      FIXED_NOW.getTime(),
    );
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
