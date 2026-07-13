/**
 * PinSetupService — set a transaction PIN on a tier_1-or-above (at least
 * email-verified) user who has no PIN yet.
 *
 * Why this exists: /kyc/submit bundles PIN setup with full identity
 * verification, which does not fit two cases this service covers instead:
 *   - the onboarding wizard, which sets the PIN right after email
 *     verification (tier_1, kycStatus still 'not_started') — before the user
 *     completes full KYC;
 *   - a user who is ALREADY fully verified but somehow has no PIN (verified
 *     before the PIN step existed, or whose setup was interrupted), who would
 *     otherwise hit an unrecoverable PinNotSetError at execute time.
 *
 * Server-side gates (CLAUDE.md §3.3 — the server is the security boundary):
 *   - the user must be at least tier_1 (email-verified) — `unverified` (tier
 *     0) is rejected;
 *   - the user must NOT already have a PIN (overwriting requires step-up, not
 *     this idempotent first-set path).
 *
 * Architecture: application layer — imports NO Prisma, NO infrastructure.
 * Reaches data through IIdentityRepository and the core PinService (§3.2 / §4.1).
 */

import { Inject, Injectable } from '@nestjs/common';

import type { KycTier, SetPinResponse } from '@handshake-agent/contracts';

import { PinService } from '../../../core/auth/pin.service';
import { tierAtLeast } from '../domain/tier-order';
import {
  PinAlreadySetError,
  PinSetupNotVerifiedError,
} from '../domain/pin-setup-errors';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from './ports/identity.repository.port';

/** Minimum KYC tier required to set a transaction PIN — email verification
 * (tier_1), not full KYC. Lets the onboarding wizard set the PIN right after
 * email verification, before the user completes KYC. */
const MIN_PIN_SETUP_TIER: KycTier = 'tier_1';

@Injectable()
export class PinSetupService {
  constructor(
    private readonly pinService: PinService,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identityRepo: IIdentityRepository,
  ) {}

  /**
   * Sets the transaction PIN for a tier_1-or-above, PIN-less user.
   *
   * @throws {PinSetupNotVerifiedError} — user missing or below tier_1.
   * @throws {PinAlreadySetError}       — user already has a PIN.
   * @throws {WeakPinError}             — PIN fails the strength gate (from PinService).
   */
  async setTransactionPin(
    userId: string,
    pin: string,
  ): Promise<SetPinResponse> {
    const user = await this.identityRepo.loadUser(userId);
    // The cast is safe: `UserRecord.kycTier` is a raw DB string but the
    // Prisma schema enforces the `KycTier` enum (mirrors kyc-gate.service.ts).
    if (
      user === null ||
      !tierAtLeast(user.kycTier as KycTier, MIN_PIN_SETUP_TIER)
    ) {
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
