/**
 * SessionService — durable device-bound step-up tracking (Fix G, CLAUDE.md §3.4).
 *
 * Manages Session rows keyed by (userId, deviceId). After the send directive +
 * PIN pass, executeSend calls recordStepUp to persist the step-up timestamp.
 * assertStepUpFresh can then be called to verify a recent step-up exists.
 *
 * Security invariants:
 *   - startOrTouch and recordStepUp are write paths; they do NOT gate or
 *     block the send flow on their own — the gate remains directive + PIN
 *     (§3.1 / §3.4). Step-up recording is the AUDIT trail, not the sole gate.
 *   - assertStepUpFresh is fail-closed: missing or stale step-up → throws.
 *   - Config TTL is read from ConfigService (never hardcoded, root §7).
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration';
import { CLOCK, type Clock } from '../common/clock';
import { StepUpRequiredError } from './domain/session-errors';
import {
  SESSION_REPOSITORY,
  type ISessionRepository,
  type SessionRecord,
} from './ports/session.repository.port';

@Injectable()
export class SessionService {
  private readonly ttlMs: number;

  constructor(
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepo: ISessionRepository,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {
    const ttlSeconds =
      this.config.get<number>('auth.stepUp.ttlSeconds' as never) ?? 900;
    this.ttlMs = ttlSeconds * 1_000;
  }

  /**
   * Upserts a session for (userId, deviceId), bumping lastActivityAt if one
   * already exists, or creating a new one. Returns the session record.
   *
   * Call this when the user begins an authenticated action so the session
   * row is in place before recordStepUp is invoked.
   */
  async startOrTouch(userId: string, deviceId: string): Promise<SessionRecord> {
    const now = this.clock.now();
    return this.sessionRepo.touchOrCreate(userId, deviceId, now);
  }

  /**
   * Records that a step-up challenge was successfully completed for
   * (userId, deviceId) at the given timestamp.
   *
   * Sets Session.stepUpCompletedAt = now (and implicitly anchors the TTL
   * window — calls to assertStepUpFresh within `auth.stepUp.ttlSeconds`
   * seconds of this call will pass without rethrowing).
   */
  async recordStepUp(
    userId: string,
    deviceId: string,
    now: Date,
  ): Promise<void> {
    await this.sessionRepo.recordStepUp(userId, deviceId, now);
  }

  /**
   * Resolves the pinnedDeviceId for the given userId.
   * Returns null when no device is bound.
   *
   * Used by executeSend to resolve the acting device when no explicit deviceId
   * is provided in the input (fix G, §3.4).
   */
  async findPinnedDeviceId(userId: string): Promise<string | null> {
    return this.sessionRepo.findPinnedDeviceId(userId);
  }

  /**
   * Resolves the Device id for (userId, fingerprint), or null when the
   * fingerprint is absent or matches no device owned by the user.
   *
   * Used by the web execute path to bind a send step-up to the acting browser
   * from the client-supplied fingerprint (§3.4). Fail-safe: returns null rather
   * than throwing so callers can fall back to the pinned device.
   */
  async findDeviceIdByFingerprint(
    userId: string,
    fingerprint: string | undefined,
  ): Promise<string | null> {
    if (!fingerprint) return null;
    return this.sessionRepo.findDeviceIdByFingerprint(userId, fingerprint);
  }

  /**
   * Asserts that the session for (userId, deviceId) has a step-up that is
   * still within the configured TTL window.
   *
   * Throws `StepUpRequiredError` when:
   *   - no active session exists for the pair ('no_session')
   *   - stepUpCompletedAt is null ('not_completed')
   *   - stepUpCompletedAt is at or older than TTL seconds ago ('expired')
   */
  async assertStepUpFresh(
    userId: string,
    deviceId: string,
    now: Date,
  ): Promise<void> {
    const session = await this.sessionRepo.findActiveByUserAndDevice(
      userId,
      deviceId,
    );

    if (session === null) {
      throw new StepUpRequiredError('no_session');
    }

    if (session.stepUpCompletedAt === null) {
      throw new StepUpRequiredError('not_completed');
    }

    // Expired when: now - stepUpCompletedAt >= ttlMs
    // (boundary is inclusive — exactly at TTL = expired)
    const ageMs = now.getTime() - session.stepUpCompletedAt.getTime();
    if (ageMs >= this.ttlMs) {
      throw new StepUpRequiredError('expired');
    }
  }
}
