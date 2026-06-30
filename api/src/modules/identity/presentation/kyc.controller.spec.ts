/**
 * Unit tests for KycController (K3 + WN-3).
 *
 * All dependencies (HandoffTokenService, KycService, WalletService) are mocked.
 * The ThrottlerGuard is bypassed in unit tests.
 *
 * Covers:
 *   - valid token → consume + completeVerification → { userId, status: 'verified' }
 *   - bad/consumed token → HandoffTokenNotFoundError → BadRequestException (400)
 *   - expired token → HandoffTokenExpiredError → BadRequestException (400)
 *   - wrong purpose → HandoffTokenWrongPurposeError → BadRequestException (400)
 *   - contact not found → ContactNotFoundError → BadRequestException (400)
 *   - KYC rejected → KycRejectedError → UnprocessableEntityException (422)
 *   - other errors re-thrown
 *   - WN-3: provisionAllEnabledNetworks called for every enabled network after KYC
 *   - WN-3: provisioning failure does NOT fail KYC completion (best-effort)
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  HandoffTokenExpiredError,
  HandoffTokenNotFoundError,
  HandoffTokenWrongPurposeError,
} from '../domain/handoff-token-errors';
import { ContactNotFoundError, KycRejectedError } from '../domain/kyc-errors';
import {
  PinAlreadySetError,
  PinSetupNotVerifiedError,
} from '../domain/pin-setup-errors';
import type { HandoffTokenService } from '../application/handoff-token.service';
import type { KycService } from '../application/kyc.service';
import type { PinSetupService } from '../application/pin-setup.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import { KycController } from './kyc.controller';
import type { KycCompleteDto } from './dto/kyc-complete.dto';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHANNEL_ADDRESS = '+2348099990001';
const USER_ID = 'user-uuid-1';

const validDto: KycCompleteDto = {
  token: 'raw-valid-token',
  nin: '12345678901',
  firstName: 'Amaka',
  lastName: 'Okafor',
  dateOfBirth: '1992-07-14',
  pin: '1357',
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeHandoffTokenService(
  consumeResult: { channelAddress: string } | Error = {
    channelAddress: CHANNEL_ADDRESS,
  },
): jest.Mocked<Pick<HandoffTokenService, 'consumeKycToken' | 'mintKycToken'>> {
  const svc = { consumeKycToken: jest.fn(), mintKycToken: jest.fn() };
  if (consumeResult instanceof Error) {
    svc.consumeKycToken.mockRejectedValue(consumeResult);
  } else {
    svc.consumeKycToken.mockResolvedValue(consumeResult);
  }
  return svc;
}

function makeKycService(
  result: { userId: string } | Error = { userId: USER_ID },
): jest.Mocked<Pick<KycService, 'completeVerification'>> {
  const svc = { completeVerification: jest.fn() };
  if (result instanceof Error) {
    svc.completeVerification.mockRejectedValue(result);
  } else {
    svc.completeVerification.mockResolvedValue(result);
  }
  return svc;
}

function makeWalletService(
  provisionResult: unknown[] | Error = [],
): jest.Mocked<Pick<WalletService, 'provisionAllEnabledNetworks'>> {
  const svc = { provisionAllEnabledNetworks: jest.fn() };
  if (provisionResult instanceof Error) {
    svc.provisionAllEnabledNetworks.mockRejectedValue(provisionResult);
  } else {
    svc.provisionAllEnabledNetworks.mockResolvedValue(provisionResult);
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
  handoffTokenService: jest.Mocked<
    Pick<HandoffTokenService, 'consumeKycToken' | 'mintKycToken'>
  > = makeHandoffTokenService(),
  kycService: jest.Mocked<
    Pick<KycService, 'completeVerification'>
  > = makeKycService(),
  walletService: jest.Mocked<
    Pick<WalletService, 'provisionAllEnabledNetworks'>
  > = makeWalletService(),
  pinSetupService: jest.Mocked<
    Pick<PinSetupService, 'setTransactionPin'>
  > = makePinSetupService(),
): KycController {
  // Suppress logger output during tests.
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return new KycController(
    handoffTokenService as unknown as HandoffTokenService,
    kycService as unknown as KycService,
    walletService as unknown as WalletService,
    pinSetupService as unknown as PinSetupService,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KycController.complete', () => {
  it('happy path: valid token + completeVerification → { userId, status: verified }', async () => {
    const controller = buildController();

    const result = await controller.complete(validDto);

    expect(result).toEqual({ userId: USER_ID, status: 'verified' });
  });

  it('passes channelAddress from token to kycService.completeVerification', async () => {
    const kycService = makeKycService();
    const controller = buildController(undefined, kycService);

    await controller.complete(validDto);

    expect(kycService.completeVerification).toHaveBeenCalledWith(
      expect.objectContaining({ channelAddress: CHANNEL_ADDRESS }),
    );
  });

  it('passes all DTO fields to kycService.completeVerification', async () => {
    const kycService = makeKycService();
    const controller = buildController(undefined, kycService);

    await controller.complete(validDto);

    expect(kycService.completeVerification).toHaveBeenCalledWith({
      channelAddress: CHANNEL_ADDRESS,
      nin: validDto.nin,
      bvn: validDto.bvn,
      firstName: validDto.firstName,
      lastName: validDto.lastName,
      dateOfBirth: validDto.dateOfBirth,
      pin: validDto.pin,
    });
  });

  it('HandoffTokenNotFoundError → BadRequestException (400)', async () => {
    const controller = buildController(
      makeHandoffTokenService(new HandoffTokenNotFoundError()),
    );

    await expect(controller.complete(validDto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('HandoffTokenExpiredError → BadRequestException (400)', async () => {
    const controller = buildController(
      makeHandoffTokenService(new HandoffTokenExpiredError()),
    );

    await expect(controller.complete(validDto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('HandoffTokenWrongPurposeError → BadRequestException (400)', async () => {
    const controller = buildController(
      makeHandoffTokenService(
        new HandoffTokenWrongPurposeError('kyc', 'confirmation'),
      ),
    );

    await expect(controller.complete(validDto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('bad token → kycService.completeVerification is NOT called', async () => {
    const kycService = makeKycService();
    const controller = buildController(
      makeHandoffTokenService(new HandoffTokenNotFoundError()),
      kycService,
    );

    await expect(controller.complete(validDto)).rejects.toThrow(
      BadRequestException,
    );
    expect(kycService.completeVerification).not.toHaveBeenCalled();
  });

  it('ContactNotFoundError from KycService → BadRequestException (400)', async () => {
    const controller = buildController(
      makeHandoffTokenService(),
      makeKycService(new ContactNotFoundError(CHANNEL_ADDRESS)),
    );

    await expect(controller.complete(validDto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('KycRejectedError from KycService → UnprocessableEntityException (422)', async () => {
    const controller = buildController(
      makeHandoffTokenService(),
      makeKycService(new KycRejectedError('NIN mismatch')),
    );

    await expect(controller.complete(validDto)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('KycRejectedError maps to a friendly message — never echoes the raw provider reason', async () => {
    const controller = buildController(
      makeHandoffTokenService(),
      makeKycService(new KycRejectedError('missing required identity fields')),
    );

    const err = await controller.complete(validDto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const message = (err as UnprocessableEntityException).message;
    // The opaque provider reason must NOT leak to the client.
    expect(message).not.toContain('missing required identity fields');
    // The friendly copy guides the user to fix their NIN/BVN.
    expect(message).toMatch(/NIN|BVN|identity/i);
  });

  it('unknown error re-thrown as-is', async () => {
    const boom = new Error('unexpected boom');
    const controller = buildController(makeHandoffTokenService(boom));

    await expect(controller.complete(validDto)).rejects.toThrow(
      'unexpected boom',
    );
  });

  // ---------------------------------------------------------------------------
  // WN-3: Eager wallet provisioning on KYC completion
  // ---------------------------------------------------------------------------

  describe('WN-3: eager wallet provisioning', () => {
    it('calls provisionAllEnabledNetworks with the userId returned by completeVerification', async () => {
      const walletService = makeWalletService([]);
      const controller = buildController(
        makeHandoffTokenService(),
        makeKycService(),
        walletService,
      );

      await controller.complete(validDto);

      expect(walletService.provisionAllEnabledNetworks).toHaveBeenCalledWith(
        USER_ID,
      );
    });

    it('still returns { userId, status: verified } even when provisionAllEnabledNetworks fails (best-effort)', async () => {
      const walletService = makeWalletService(
        new Error('Blockradar unavailable'),
      );
      const controller = buildController(
        makeHandoffTokenService(),
        makeKycService(),
        walletService,
      );

      // KYC response must succeed regardless of provisioning failure.
      const result = await controller.complete(validDto);

      expect(result).toEqual({ userId: USER_ID, status: 'verified' });
    });

    it('does NOT call provisionAllEnabledNetworks when KYC verification fails', async () => {
      const walletService = makeWalletService([]);
      const controller = buildController(
        makeHandoffTokenService(),
        makeKycService(new KycRejectedError('NIN mismatch')),
        walletService,
      );

      await expect(controller.complete(validDto)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(walletService.provisionAllEnabledNetworks).not.toHaveBeenCalled();
    });

    it('does NOT call provisionAllEnabledNetworks when token consumption fails', async () => {
      const walletService = makeWalletService([]);
      const controller = buildController(
        makeHandoffTokenService(new HandoffTokenNotFoundError()),
        makeKycService(),
        walletService,
      );

      await expect(controller.complete(validDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(walletService.provisionAllEnabledNetworks).not.toHaveBeenCalled();
    });
  });
});

describe('KycController.setPin', () => {
  const AUTH_USER = { userId: USER_ID } as never;

  it('sets the PIN for a verified PIN-less user and returns { hasPin: true }', async () => {
    const pinSetup = makePinSetupService();
    const controller = buildController(
      makeHandoffTokenService(),
      makeKycService(),
      makeWalletService(),
      pinSetup,
    );

    const result = await controller.setPin({ pin: '1357' }, AUTH_USER);

    expect(pinSetup.setTransactionPin).toHaveBeenCalledWith(USER_ID, '1357');
    expect(result).toEqual({ hasPin: true });
  });

  it('PinSetupNotVerifiedError → ForbiddenException (403)', async () => {
    const controller = buildController(
      makeHandoffTokenService(),
      makeKycService(),
      makeWalletService(),
      makePinSetupService(new PinSetupNotVerifiedError()),
    );

    await expect(controller.setPin({ pin: '1357' }, AUTH_USER)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('PinAlreadySetError → ConflictException (409)', async () => {
    const controller = buildController(
      makeHandoffTokenService(),
      makeKycService(),
      makeWalletService(),
      makePinSetupService(new PinAlreadySetError()),
    );

    await expect(controller.setPin({ pin: '1357' }, AUTH_USER)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rethrows unknown errors as-is', async () => {
    const controller = buildController(
      makeHandoffTokenService(),
      makeKycService(),
      makeWalletService(),
      makePinSetupService(new Error('unexpected boom')),
    );

    await expect(controller.setPin({ pin: '1357' }, AUTH_USER)).rejects.toThrow(
      'unexpected boom',
    );
  });
});
