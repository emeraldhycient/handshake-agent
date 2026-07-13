/**
 * KYC endpoints: transaction-PIN setup + Sumsub session minting.
 *
 * The legacy synchronous NIN/BVN endpoints (`POST /kyc/complete` — WhatsApp
 * handoff-token redemption, and `POST /kyc/submit` — web-native submission)
 * were retired: onboarding now grants tier_1 via email-OTP and tier_2/tier_3
 * via the Sumsub webhook. See
 * docs/superpowers/plans/2026-07-13-retire-legacy-sync-kyc-endpoints.md.
 *
 * Architecture: presentation layer only — no Prisma, no domain logic, no agent.
 * Imports through application ports only (CLAUDE.md §4.1).
 */

import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import type {
  SetPinResponse,
  SumsubTokenResponse,
} from '@handshake-agent/contracts';

import {
  PinAlreadySetError,
  PinSetupNotVerifiedError,
} from '../domain/pin-setup-errors';
import { KycService } from '../application/kyc.service';
import { PinSetupService } from '../application/pin-setup.service';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/presentation/jwt-auth.guard';
import { SetPinDto } from './dto/set-pin.dto';
import { SumsubTokenDto } from './dto/sumsub-token.dto';

@Controller('kyc')
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly pinSetupService: PinSetupService,
  ) {}

  /**
   * Set the transaction PIN for an already-verified user who has no PIN yet
   * (verified-but-PIN-less recovery). JWT-authenticated; the service gates it
   * to verified, PIN-less users server-side (CLAUDE.md §3.3).
   *
   * @throws {ForbiddenException} — user is not verified (must finish KYC first).
   * @throws {ConflictException} — a PIN already exists (reset requires step-up).
   */
  @Post('pin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async setPin(
    @Body() dto: SetPinDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<SetPinResponse> {
    try {
      return await this.pinSetupService.setTransactionPin(
        currentUser.userId,
        dto.pin,
      );
    } catch (err) {
      if (err instanceof PinSetupNotVerifiedError) {
        throw new ForbiddenException(err.message);
      }
      if (err instanceof PinAlreadySetError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  /**
   * Mints a Sumsub WebSDK access token for a `tier_2`/`tier_3` verification
   * upgrade (task 3.4). JWT-authenticated; the prerequisite tier check and the
   * provider call happen in KycService.createSumsubSession.
   *
   * No local try/catch: KycService.createSumsubSession throws
   * SumsubPrerequisiteNotMetError (code SUMSUB_PREREQUISITE_NOT_MET) when the
   * account hasn't earned the prior tier rung — the global DomainExceptionFilter
   * maps it to 403, mirroring the other KYC/gate error codes.
   */
  @Post('sumsub/token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async createSumsubToken(
    @Body() dto: SumsubTokenDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<SumsubTokenResponse> {
    return this.kycService.createSumsubSession(currentUser.userId, dto.level);
  }
}
