/**
 * StepUpService — the shared step-up-on-sensitive-action chain (A1, CLAUDE.md §3.4).
 *
 * Adding a withdrawal destination (bank/crypto beneficiary) is step-up gated
 * (audit R2): the server verifies the transaction PIN and records a fresh
 * device-bound step-up BEFORE the write is allowed. The web BeneficiaryController
 * and the WhatsApp Flow controller both ran an identical private copy of this
 * chain; it now lives here so there is ONE canonical implementation (root §13.1).
 *
 * The chain (order is security-critical):
 *   1. PinService.verifyPin — its own atomic lockout; throws Pin* domain errors.
 *   2. Resolve the acting device: the client fingerprint (web) → else the user's
 *      pinned device (WhatsApp has no browser fingerprint).
 *   3. No traceable device → StepUpRequiredError (fail-closed, §3.4): nothing is
 *      persisted without a device to bind the step-up to.
 *   4. SessionService.startOrTouch + recordStepUp — the device-bound step-up
 *      audit record (mirrors the executeSend money-path).
 *
 * This is NOT the directive-consuming money-path step-up (executeSend still owns
 * the request_step_up directive + nonce chain); an add is not a money-moving
 * proposal, so no directive is issued here.
 */

import { Injectable } from '@nestjs/common';

import { StepUpRequiredError } from './domain/session-errors';
import { PinService } from './pin.service';
import { SessionService } from './session.service';

@Injectable()
export class StepUpService {
  constructor(
    private readonly pinService: PinService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Runs the full step-up chain for a sensitive, non-money-moving action (e.g.
   * adding a payout destination). Resolves on success; throws on any failure so
   * the caller can fail-closed and skip the write.
   *
   * @throws {PinInvalidError | PinLockedError | PinNotSetError} on PIN failure.
   * @throws {StepUpRequiredError} when no device can be resolved to bind the
   *         step-up to (fail-closed).
   */
  async assertStepUpForSensitiveAction(
    userId: string,
    pin: string,
    deviceFingerprint?: string,
  ): Promise<void> {
    // 1. Verify PIN first (its own atomic lockout). Throws Pin* domain errors.
    await this.pinService.verifyPin(userId, pin);

    // 2. Resolve the acting device: client fingerprint → else the pinned device.
    const deviceId =
      (await this.sessionService.findDeviceIdByFingerprint(
        userId,
        deviceFingerprint,
      )) ?? (await this.sessionService.findPinnedDeviceId(userId));

    // 3. No traceable device → cannot record a device-bound step-up (fail-closed).
    if (!deviceId) {
      throw new StepUpRequiredError('no_session');
    }

    // 4. Record the device-bound step-up (mirrors executeSend Step 7b).
    const now = new Date();
    await this.sessionService.startOrTouch(userId, deviceId);
    await this.sessionService.recordStepUp(userId, deviceId, now);
  }
}
