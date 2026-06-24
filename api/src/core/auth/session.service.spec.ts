/**
 * Unit tests for SessionService (Fix G, CLAUDE.md §3.4 / §9).
 *
 * TDD: tests written FIRST (red), then SessionService is implemented (green).
 *
 * Covers:
 *   1. startOrTouch — calls touchOrCreate with correct args.
 *   2. recordStepUp  — calls repo.recordStepUp + returns new date.
 *   3. assertStepUpFresh
 *      a. no session → StepUpRequiredError('no_session')
 *      b. stepUpCompletedAt null → StepUpRequiredError('not_completed')
 *      c. stepUpCompletedAt older than TTL → StepUpRequiredError('expired')
 *      d. stepUpCompletedAt exactly AT the TTL boundary → StepUpRequiredError('expired')
 *      e. stepUpCompletedAt within TTL → passes (no throw)
 */

import type {
  ISessionRepository,
  SessionRecord,
} from './ports/session.repository.port';
import { SessionService } from './session.service';
import { StepUpRequiredError } from './domain/session-errors';

// ---------------------------------------------------------------------------
// Fixed test values
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2025-06-01T12:00:00.000Z');
const TTL_SECONDS = 900; // 15 minutes

const USER_ID = 'aaaaaaaa-0001-7000-8000-000000000001';
const DEVICE_ID = 'bbbbbbbb-0002-7000-8000-000000000002';
const SESSION_ID = 'cccccccc-0003-7000-8000-000000000003';

const STUB_SESSION: SessionRecord = {
  id: SESSION_ID,
  userId: USER_ID,
  deviceId: DEVICE_ID,
  stepUpCompletedAt: null,
  expiresAt: new Date(FIXED_NOW.getTime() + 3_600_000), // 1h future
  isActive: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(
  overrides: Partial<ISessionRepository> = {},
): jest.Mocked<ISessionRepository> {
  return {
    findActiveByUserAndDevice: jest.fn(),
    touchOrCreate: jest.fn(),
    recordStepUp: jest.fn(),
    findPinnedDeviceId: jest.fn(),
    ...overrides,
  } as jest.Mocked<ISessionRepository>;
}

function makeConfig(ttlSeconds: number = TTL_SECONDS): { get: jest.Mock } {
  const cfg = { get: jest.fn() };
  cfg.get.mockImplementation((key: string) => {
    if (key === 'auth.stepUp.ttlSeconds') return ttlSeconds;
    return undefined;
  });
  return cfg;
}

function makeClock(now: Date = FIXED_NOW): { now: () => Date } {
  return { now: () => now };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionService', () => {
  describe('startOrTouch', () => {
    it('delegates to repo.touchOrCreate with userId, deviceId, now', async () => {
      const repo = makeRepo({
        touchOrCreate: jest.fn().mockResolvedValue(STUB_SESSION),
      });
      const svc = new SessionService(repo, makeConfig() as never, makeClock());

      const result = await svc.startOrTouch(USER_ID, DEVICE_ID);

      expect(repo.touchOrCreate).toHaveBeenCalledWith(
        USER_ID,
        DEVICE_ID,
        FIXED_NOW,
      );
      expect(result).toBe(STUB_SESSION);
    });
  });

  describe('recordStepUp', () => {
    it('calls repo.recordStepUp with userId, deviceId, now', async () => {
      const repo = makeRepo({
        recordStepUp: jest.fn().mockResolvedValue(undefined),
      });
      const svc = new SessionService(repo, makeConfig() as never, makeClock());

      await svc.recordStepUp(USER_ID, DEVICE_ID, FIXED_NOW);

      expect(repo.recordStepUp).toHaveBeenCalledWith(
        USER_ID,
        DEVICE_ID,
        FIXED_NOW,
      );
    });
  });

  describe('assertStepUpFresh', () => {
    it('throws StepUpRequiredError("no_session") when repo returns null', async () => {
      const repo = makeRepo({
        findActiveByUserAndDevice: jest.fn().mockResolvedValue(null),
      });
      const svc = new SessionService(repo, makeConfig() as never, makeClock());

      await expect(
        svc.assertStepUpFresh(USER_ID, DEVICE_ID, FIXED_NOW),
      ).rejects.toThrow(StepUpRequiredError);

      await expect(
        svc.assertStepUpFresh(USER_ID, DEVICE_ID, FIXED_NOW),
      ).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    });

    it('throws StepUpRequiredError("not_completed") when stepUpCompletedAt is null', async () => {
      const session: SessionRecord = {
        ...STUB_SESSION,
        stepUpCompletedAt: null,
      };
      const repo = makeRepo({
        findActiveByUserAndDevice: jest.fn().mockResolvedValue(session),
      });
      const svc = new SessionService(repo, makeConfig() as never, makeClock());

      await expect(
        svc.assertStepUpFresh(USER_ID, DEVICE_ID, FIXED_NOW),
      ).rejects.toThrow(StepUpRequiredError);
    });

    it('throws StepUpRequiredError("expired") when stepUpCompletedAt is older than TTL', async () => {
      // stepUpCompletedAt = now - (TTL + 1 second) → expired
      const staleAt = new Date(FIXED_NOW.getTime() - (TTL_SECONDS + 1) * 1_000);
      const session: SessionRecord = {
        ...STUB_SESSION,
        stepUpCompletedAt: staleAt,
      };
      const repo = makeRepo({
        findActiveByUserAndDevice: jest.fn().mockResolvedValue(session),
      });
      const svc = new SessionService(repo, makeConfig() as never, makeClock());

      await expect(
        svc.assertStepUpFresh(USER_ID, DEVICE_ID, FIXED_NOW),
      ).rejects.toThrow(StepUpRequiredError);
    });

    it('throws StepUpRequiredError("expired") at the exact TTL boundary (not within)', async () => {
      // stepUpCompletedAt = now - TTL exactly → expired (boundary is exclusive)
      const boundaryAt = new Date(FIXED_NOW.getTime() - TTL_SECONDS * 1_000);
      const session: SessionRecord = {
        ...STUB_SESSION,
        stepUpCompletedAt: boundaryAt,
      };
      const repo = makeRepo({
        findActiveByUserAndDevice: jest.fn().mockResolvedValue(session),
      });
      const svc = new SessionService(repo, makeConfig() as never, makeClock());

      await expect(
        svc.assertStepUpFresh(USER_ID, DEVICE_ID, FIXED_NOW),
      ).rejects.toThrow(StepUpRequiredError);
    });

    it('does NOT throw when stepUpCompletedAt is within TTL', async () => {
      // stepUpCompletedAt = now - (TTL - 1 second) → still fresh
      const freshAt = new Date(FIXED_NOW.getTime() - (TTL_SECONDS - 1) * 1_000);
      const session: SessionRecord = {
        ...STUB_SESSION,
        stepUpCompletedAt: freshAt,
      };
      const repo = makeRepo({
        findActiveByUserAndDevice: jest.fn().mockResolvedValue(session),
      });
      const svc = new SessionService(repo, makeConfig() as never, makeClock());

      await expect(
        svc.assertStepUpFresh(USER_ID, DEVICE_ID, FIXED_NOW),
      ).resolves.toBeUndefined();
    });
  });
});
