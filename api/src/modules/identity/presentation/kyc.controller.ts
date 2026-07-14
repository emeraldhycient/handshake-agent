/**
 * KYC controller — the endpoints that survive the retirement of the legacy
 * synchronous NIN/BVN path (`POST /kyc/submit` + `POST /kyc/complete` are gone,
 * superseded by email-OTP tier_1 + the Sumsub webhook for tier_2/3):
 *   POST /kyc/pin           — set the transaction PIN for a verified, PIN-less user
 *   POST /kyc/sumsub/token  — mint a Sumsub WebSDK token for a tier_2/tier_3 upgrade
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
   * (verified-but-PIN-less recovery). JWT-authenticated; the service gates it to
   * verified, PIN-less users server-side (CLAUDE.md §3.3).
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
   * upgrade. JWT-authenticated; the prerequisite tier check and the provider
   * call happen in KycService.createSumsubSession, which throws
   * SumsubPrerequisiteNotMetError (code SUMSUB_PREREQUISITE_NOT_MET → 403 via the
   * global DomainExceptionFilter) when the account hasn't earned the prior rung.
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
