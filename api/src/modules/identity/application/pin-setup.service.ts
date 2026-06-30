/**
 * PinSetupService — set a transaction PIN on an already-verified user who has
 * no PIN yet (verified-but-PIN-less recovery).
 *
 * Why this exists: /kyc/submit bundles PIN setup with identity verification,
 * which does not fit a user who is ALREADY verified but somehow has no PIN
 * (verified before the PIN step existed, or whose setup was interrupted). Such a
 * user passes the verified gate and then hits an unrecoverable PinNotSetError at
 * execute time. This service gives them a recovery path.
 *
 * Server-side gates (CLAUDE.md §3.3 — the server is the security boundary):
 *   - the user must be KYC-verified (PIN belongs to the verified-account state);
 *   - the user must NOT already have a PIN (overwriting requires step-up, not
 *     this idempotent first-set path).
 *
 * Architecture: application layer — imports NO Prisma, NO infrastructure.
 * Reaches data through IIdentityRepository and the core PinService (§3.2 / §4.1).
 */

import { Inject, Injectable } from '@nestjs/common';

import type { SetPinResponse } from '@handshake-agent/contracts';

import { PinService } from '../../../core/auth/pin.service';
import {
  PinAlreadySetError,
  PinSetupNotVerifiedError,
} from '../domain/pin-setup-errors';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from './ports/identity.repository.port';

const VERIFIED_STATUS = 'verified';

@Injectable()
export class PinSetupService {
  constructor(
    private readonly pinService: PinService,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identityRepo: IIdentityRepository,
  ) {}

  /**
   * Sets the transaction PIN for a verified, PIN-less user.
   *
   * @throws {PinSetupNotVerifiedError} — user missing or not KYC-verified.
   * @throws {PinAlreadySetError}       — user already has a PIN.
   * @throws {WeakPinError}             — PIN fails the strength gate (from PinService).
   */
  async setTransactionPin(
    userId: string,
    pin: string,
  ): Promise<SetPinResponse> {
    const user = await this.identityRepo.loadUser(userId);
    if (user === null || user.kycStatus !== VERIFIED_STATUS) {
      throw new PinSetupNotVerifiedError();
    }

    if (await this.pinService.hasPin(userId)) {
      throw new PinAlreadySetError();
    }

    // PinService.setPin re-validates strength (server-side security boundary).
    await this.pinService.setPin(userId, pin);
    return { hasPin: true };
  }
}
