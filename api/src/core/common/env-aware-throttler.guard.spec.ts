/**
 * Unit spec for EnvAwareThrottlerGuard (M1 — global rate limiting).
 *
 * Registered as a global APP_GUARD so EVERY endpoint (incl. the money-movement
 * POST /chat/proposals/:proposalId/execute) is rate-limited in production —
 * closing the brute-force gap left by opt-in-only throttling.
 *
 * The one nuance: e2e suites hammer endpoints from a single IP (supertest =
 * 127.0.0.1) and would trip 429. Mirroring the app's existing `NODE_ENV==='test'`
 * special-casing (see app.module ignoreEnvFile), the guard skips throttling under
 * test WITHOUT weakening production limits.
 */

import type { ExecutionContext } from '@nestjs/common';

import { EnvAwareThrottlerGuard } from './env-aware-throttler.guard';

/** Reach the protected shouldSkip for assertion without invoking the DI stack. */
type ShouldSkip = (context: ExecutionContext) => Promise<boolean>;

/** The guard's prototype exposing the protected shouldSkip for direct assertion. */
interface GuardProto {
  shouldSkip: ShouldSkip;
}

function makeGuard(): { skip: ShouldSkip } {
  // The guard's real deps (storage/reflector/options) are irrelevant to
  // shouldSkip; construct a bare instance and invoke the protected method on it.
  const proto = EnvAwareThrottlerGuard.prototype as unknown as GuardProto;
  const guard = Object.create(proto) as GuardProto;
  const skip: ShouldSkip = (context) => guard.shouldSkip(context);
  return { skip };
}

describe('EnvAwareThrottlerGuard', () => {
  const dummyContext = {} as ExecutionContext;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('skips throttling under NODE_ENV=test (so e2e supertest is not 429ed)', async () => {
    process.env.NODE_ENV = 'test';
    const { skip } = makeGuard();
    await expect(skip(dummyContext)).resolves.toBe(true);
  });

  it('does NOT skip throttling in production (prod stays strict)', async () => {
    process.env.NODE_ENV = 'production';
    const { skip } = makeGuard();
    await expect(skip(dummyContext)).resolves.toBe(false);
  });

  it('does NOT skip throttling in development', async () => {
    process.env.NODE_ENV = 'development';
    const { skip } = makeGuard();
    await expect(skip(dummyContext)).resolves.toBe(false);
  });
});
