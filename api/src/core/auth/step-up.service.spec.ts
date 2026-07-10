/**
 * TDD — step-up.service.spec.ts (A1)
 *
 * StepUpService is the single shared implementation of the step-up-on-sensitive-
 * action chain that the web BeneficiaryController and the WhatsApp Flow controller
 * both previously duplicated verbatim (`requireStepUpForAdd`). The chain is:
 *
 *   1. PinService.verifyPin (lockout-protected)  — throws Pin* on failure.
 *   2. Resolve the acting device: client fingerprint → else the pinned device.
 *   3. No traceable device → StepUpRequiredError (fail-closed).
 *   4. SessionService.startOrTouch + recordStepUp (device-bound step-up audit).
 *
 * Behaviour must stay byte-identical to the extracted controller copies.
 */

import { PinInvalidError } from './domain/pin-errors';
import { StepUpRequiredError } from './domain/session-errors';
import type { PinService } from './pin.service';
import type { SessionService } from './session.service';
import { StepUpService } from './step-up.service';

describe('StepUpService', () => {
  let pinService: { verifyPin: jest.Mock };
  let sessionService: {
    findDeviceIdByFingerprint: jest.Mock;
    findPinnedDeviceId: jest.Mock;
    startOrTouch: jest.Mock;
    recordStepUp: jest.Mock;
  };
  let service: StepUpService;

  beforeEach(() => {
    pinService = { verifyPin: jest.fn().mockResolvedValue(undefined) };
    sessionService = {
      findDeviceIdByFingerprint: jest.fn().mockResolvedValue(null),
      findPinnedDeviceId: jest.fn().mockResolvedValue('device-1'),
      startOrTouch: jest.fn().mockResolvedValue(undefined),
      recordStepUp: jest.fn().mockResolvedValue(undefined),
    };
    service = new StepUpService(
      pinService as unknown as PinService,
      sessionService as unknown as SessionService,
    );
  });

  it('verifies the PIN then records a device-bound step-up on the pinned device', async () => {
    await service.assertStepUpForSensitiveAction('user-1', '5731');

    expect(pinService.verifyPin).toHaveBeenCalledWith('user-1', '5731');
    expect(sessionService.startOrTouch).toHaveBeenCalledWith(
      'user-1',
      'device-1',
    );
    expect(sessionService.recordStepUp).toHaveBeenCalledWith(
      'user-1',
      'device-1',
      expect.any(Date),
    );
  });

  it('binds the step-up to the client fingerprint when it resolves a device', async () => {
    sessionService.findDeviceIdByFingerprint.mockResolvedValue('device-fp');

    await service.assertStepUpForSensitiveAction('user-1', '5731', 'fp-abc');

    expect(sessionService.findDeviceIdByFingerprint).toHaveBeenCalledWith(
      'user-1',
      'fp-abc',
    );
    // Fingerprint matched → never consults the pinned device.
    expect(sessionService.findPinnedDeviceId).not.toHaveBeenCalled();
    expect(sessionService.recordStepUp).toHaveBeenCalledWith(
      'user-1',
      'device-fp',
      expect.any(Date),
    );
  });

  it('falls back to the pinned device when the fingerprint resolves nothing', async () => {
    sessionService.findDeviceIdByFingerprint.mockResolvedValue(null);
    sessionService.findPinnedDeviceId.mockResolvedValue('device-pinned');

    await service.assertStepUpForSensitiveAction('user-1', '5731', 'fp-none');

    expect(sessionService.recordStepUp).toHaveBeenCalledWith(
      'user-1',
      'device-pinned',
      expect.any(Date),
    );
  });

  it('propagates a PIN error and never records a step-up', async () => {
    pinService.verifyPin.mockRejectedValue(new PinInvalidError(2));

    await expect(
      service.assertStepUpForSensitiveAction('user-1', 'bad'),
    ).rejects.toThrow(PinInvalidError);

    expect(sessionService.findPinnedDeviceId).not.toHaveBeenCalled();
    expect(sessionService.recordStepUp).not.toHaveBeenCalled();
  });

  it('throws StepUpRequiredError (fail-closed) when no device resolves, without recording', async () => {
    sessionService.findDeviceIdByFingerprint.mockResolvedValue(null);
    sessionService.findPinnedDeviceId.mockResolvedValue(null);

    await expect(
      service.assertStepUpForSensitiveAction('user-1', '5731'),
    ).rejects.toThrow(StepUpRequiredError);

    expect(sessionService.startOrTouch).not.toHaveBeenCalled();
    expect(sessionService.recordStepUp).not.toHaveBeenCalled();
  });

  it('verifies the PIN BEFORE resolving the device (order is security-critical)', async () => {
    const calls: string[] = [];
    pinService.verifyPin.mockImplementation(() => {
      calls.push('pin');
      return Promise.resolve();
    });
    sessionService.findPinnedDeviceId.mockImplementation(() => {
      calls.push('device');
      return Promise.resolve('device-1');
    });

    await service.assertStepUpForSensitiveAction('user-1', '5731');

    expect(calls).toEqual(['pin', 'device']);
  });
});
