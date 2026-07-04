/**
 * EnvAwareThrottlerGuard (M1 — global rate limiting).
 *
 * A `ThrottlerGuard` subclass registered globally (APP_GUARD) so EVERY endpoint
 * is rate-limited by default — including the money-movement execute route where
 * PIN is verified — instead of relying on per-controller opt-in.
 *
 * Under `NODE_ENV==='test'` it skips throttling entirely: e2e suites drive many
 * requests from a single IP (supertest = 127.0.0.1) and would otherwise trip 429.
 * This mirrors the app's existing `NODE_ENV==='test'` special-casing (see
 * `app.module` `ignoreEnvFile`) and does NOT relax production limits — prod and
 * dev remain fully throttled by the configured named throttlers.
 */

import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class EnvAwareThrottlerGuard extends ThrottlerGuard {
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return Promise.resolve(true);
    }
    return super.shouldSkip(context);
  }
}
