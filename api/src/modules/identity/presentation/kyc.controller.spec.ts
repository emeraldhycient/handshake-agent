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
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  HandoffTokenExpiredError,
  HandoffTokenNotFoundError,
  HandoffTokenWrongPurposeError,
} from '../domain/handoff-token-errors';
import { ContactNotFoundError, KycRejectedError } from '../domain/kyc-errors';
import type { HandoffTokenService } from '../application/handoff-token.service';
import type { KycService } from '../application/kyc.service';
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
  pin: '1234',
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
): KycController {
  // Suppress logger output during tests.
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return new KycController(
    handoffTokenService as unknown as HandoffTokenService,
    kycService as unknown as KycService,
    walletService as unknown as WalletService,
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
