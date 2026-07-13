/**
 * Unit tests for KycController.
 *
 * Covers the two surviving endpoints:
 *   - POST /kyc/pin (setPin) — sets the transaction PIN for a verified,
 *     PIN-less user.
 *   - POST /kyc/sumsub/token (createSumsubToken) — mints a Sumsub WebSDK
 *     access token for a tier_2/tier_3 upgrade.
 *
 * The legacy POST /kyc/complete + POST /kyc/submit handlers (and their
 * HandoffTokenService/WalletService dependencies) were retired — see
 * docs/superpowers/plans/2026-07-13-retire-legacy-sync-kyc-endpoints.md.
 */

import { ConflictException, ForbiddenException } from '@nestjs/common';

import { SumsubPrerequisiteNotMetError } from '../domain/kyc-errors';
import {
  PinAlreadySetError,
  PinSetupNotVerifiedError,
} from '../domain/pin-setup-errors';
import type { KycService } from '../application/kyc.service';
import type { PinSetupService } from '../application/pin-setup.service';
import { KycController } from './kyc.controller';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-uuid-1';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeKycService(
  result: { token: string; userId: string } | Error = {
    token: 'sumsub-webSdk-token-abc',
    userId: USER_ID,
  },
): jest.Mocked<Pick<KycService, 'createSumsubSession'>> {
  const svc = { createSumsubSession: jest.fn() };
  if (result instanceof Error) {
    svc.createSumsubSession.mockRejectedValue(result);
  } else {
    svc.createSumsubSession.mockResolvedValue(result);
  }
  return svc;
}

function makePinSetupService(
  result: { hasPin: true } | Error = { hasPin: true },
): jest.Mocked<Pick<PinSetupService, 'setTransactionPin'>> {
  const svc = { setTransactionPin: jest.fn() };
  if (result instanceof Error) {
    svc.setTransactionPin.mockRejectedValue(result);
  } else {
    svc.setTransactionPin.mockResolvedValue(result);
  }
  return svc;
}

function buildController(
  kycService: jest.Mocked<
    Pick<KycService, 'createSumsubSession'>
  > = makeKycService(),
  pinSetupService: jest.Mocked<
    Pick<PinSetupService, 'setTransactionPin'>
  > = makePinSetupService(),
): KycController {
  return new KycController(
    kycService as unknown as KycService,
    pinSetupService as unknown as PinSetupService,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KycController.setPin', () => {
  const AUTH_USER = { userId: USER_ID } as never;

  it('sets the PIN for a verified PIN-less user and returns { hasPin: true }', async () => {
    const pinSetup = makePinSetupService();
    const controller = buildController(makeKycService(), pinSetup);

    const result = await controller.setPin({ pin: '1357' }, AUTH_USER);

    expect(pinSetup.setTransactionPin).toHaveBeenCalledWith(USER_ID, '1357');
    expect(result).toEqual({ hasPin: true });
  });

  it('PinSetupNotVerifiedError → ForbiddenException (403)', async () => {
    const controller = buildController(
      makeKycService(),
      makePinSetupService(new PinSetupNotVerifiedError()),
    );

    await expect(controller.setPin({ pin: '1357' }, AUTH_USER)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('PinAlreadySetError → ConflictException (409)', async () => {
    const controller = buildController(
      makeKycService(),
      makePinSetupService(new PinAlreadySetError()),
    );

    await expect(controller.setPin({ pin: '1357' }, AUTH_USER)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rethrows unknown errors as-is', async () => {
    const controller = buildController(
      makeKycService(),
      makePinSetupService(new Error('unexpected boom')),
    );

    await expect(controller.setPin({ pin: '1357' }, AUTH_USER)).rejects.toThrow(
      'unexpected boom',
    );
  });
});

describe('KycController.createSumsubToken', () => {
  const AUTH_USER = { userId: USER_ID } as never;

  it('calls kycService.createSumsubSession(userId, level) and returns { token, userId }', async () => {
    const kycService = makeKycService({
      token: 'sumsub-webSdk-token-abc',
      userId: USER_ID,
    });
    const controller = buildController(kycService);

    const result = await controller.createSumsubToken(
      { level: 'tier_2' },
      AUTH_USER,
    );

    expect(kycService.createSumsubSession).toHaveBeenCalledWith(
      USER_ID,
      'tier_2',
    );
    expect(result).toEqual({
      token: 'sumsub-webSdk-token-abc',
      userId: USER_ID,
    });
  });

  it('passes the requested level through untouched (tier_3)', async () => {
    const kycService = makeKycService();
    const controller = buildController(kycService);

    await controller.createSumsubToken({ level: 'tier_3' }, AUTH_USER);

    expect(kycService.createSumsubSession).toHaveBeenCalledWith(
      USER_ID,
      'tier_3',
    );
  });

  it('SumsubPrerequisiteNotMetError from the service is NOT caught locally — it bubbles for the global filter to map to 403', async () => {
    const kycService = makeKycService(
      new SumsubPrerequisiteNotMetError('tier_2', 'tier_1', 'unverified'),
    );
    const controller = buildController(kycService);

    await expect(
      controller.createSumsubToken({ level: 'tier_2' }, AUTH_USER),
    ).rejects.toBeInstanceOf(SumsubPrerequisiteNotMetError);
  });
});
