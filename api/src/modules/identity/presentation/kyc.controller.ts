/**
 * KYC web-handoff endpoint (K3 + WN-3).
 *
 * POST /kyc/complete — public endpoint (no JWT required; security is via the
 * single-use HandoffToken). Throttled to prevent brute-force.
 *
 * Flow:
 *   1. Consume the single-use HandoffToken → resolve channelAddress.
 *   2. Call KycService.completeVerification with the submitted identity data.
 *   3. Best-effort: eagerly provision a wallet for every enabled network
 *      (WN-3). The lazy getOrProvisionNetworkWallet in the buy/receive flows
 *      is the fallback; this is an optimisation and MUST NOT fail the response.
 *   4. Return { userId, status: 'verified' }.
 *
 * Error mapping:
 *   - HandoffTokenNotFoundError / HandoffTokenExpiredError / HandoffTokenWrongPurposeError → 400
 *   - ContactNotFoundError → 400
 *   - KycRejectedError → 422
 *
 * Architecture: presentation layer only — no Prisma, no domain logic, no agent.
 * Imports through application ports only (CLAUDE.md §4.1).
 * WalletService is injected here (presentation layer) so the identity→wallets
 * dependency is kept at the composition layer; dependency-cruiser permits it
 * (no rule forbids cross-feature imports at the presentation/module level).
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';

import type {
  KycCompleteResponse,
  SetPinResponse,
  SumsubTokenResponse,
} from '@handshake-agent/contracts';

import { HandoffTokenDomainError } from '../domain/handoff-token-errors';
import { ContactNotFoundError, KycRejectedError } from '../domain/kyc-errors';
import {
  PinAlreadySetError,
  PinSetupNotVerifiedError,
} from '../domain/pin-setup-errors';
import { HandoffTokenService } from '../application/handoff-token.service';
import { KycService } from '../application/kyc.service';
import { PinSetupService } from '../application/pin-setup.service';
import { WalletService } from '../../wallets/application/wallet.service';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/presentation/jwt-auth.guard';
import { KycCompleteDto } from './dto/kyc-complete.dto';
import { KycSubmitDto } from './dto/kyc-submit.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { SumsubTokenDto } from './dto/sumsub-token.dto';

@Controller('kyc')
export class KycController {
  private readonly logger = new Logger(KycController.name);

  constructor(
    private readonly handoffTokenService: HandoffTokenService,
    private readonly kycService: KycService,
    private readonly walletService: WalletService,
    private readonly pinSetupService: PinSetupService,
  ) {}

  /**
   * Redeem a single-use KYC handoff token and complete identity verification.
   *
   * Public endpoint — secured by the single-use token (≥256-bit CSPRNG) and
   * rate-limited by ThrottlerGuard. No JWT required — the token IS the credential.
   *
   * After a successful verification, wallets are eagerly provisioned for all
   * enabled networks (WN-3). This is best-effort — a provisioning failure is
   * logged as a warning and does NOT affect the 200 response. The lazy
   * getOrProvisionNetworkWallet in later flows is the safe fallback.
   *
   * @throws {BadRequestException} — invalid/expired/consumed token, or contact not found.
   * @throws {UnprocessableEntityException} — KYC provider rejected the identity data.
   */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Body() dto: KycCompleteDto): Promise<KycCompleteResponse> {
    // Step 1: Consume the handoff token → get the bound channelAddress.
    let channelAddress: string;
    try {
      const result = await this.handoffTokenService.consumeKycToken(dto.token);
      channelAddress = result.channelAddress;
    } catch (err) {
      if (err instanceof HandoffTokenDomainError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    // Step 2: Run KYC verification + atomic write.
    let userId: string;
    try {
      ({ userId } = await this.kycService.completeVerification({
        channelAddress,
        nin: dto.nin,
        bvn: dto.bvn,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth,
        pin: dto.pin,
      }));
    } catch (err) {
      if (err instanceof ContactNotFoundError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof KycRejectedError) {
        // Surface the friendly userMessage — never the raw provider reason.
        throw new UnprocessableEntityException(err.userMessage);
      }
      throw err;
    }

    // Step 3 (WN-3): Eagerly provision addresses for all enabled networks.
    // Best-effort — failure must not fail the KYC response. The lazy
    // getOrProvisionNetworkWallet call in subsequent flows is the safe fallback
    // (it is idempotent, so a later retry is always safe).
    try {
      await this.walletService.provisionAllEnabledNetworks(userId);
    } catch (err) {
      this.logger.warn(
        `WN-3: eager wallet provisioning failed for user ${userId} — ` +
          `lazy provisioning in buy/receive flows will serve as fallback. ` +
          `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { userId, status: 'verified' };
  }

  /**
   * Complete KYC for a web-native user (JWT session).
   *
   * Secured by JwtAuthGuard (Bearer token from WebAuthModule).
   * The user already exists (created at email signup); this upgrades them to
   * Tier-1 verified and sets their transaction PIN.
   *
   * @throws {UnprocessableEntityException} — KYC provider rejected identity data.
   */
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async submit(
    @Body() dto: KycSubmitDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<KycCompleteResponse> {
    let userId: string;
    try {
      ({ userId } = await this.kycService.completeVerificationForUser({
        userId: currentUser.userId,
        nin: dto.nin,
        bvn: dto.bvn,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth,
        pin: dto.pin,
      }));
    } catch (err) {
      if (err instanceof KycRejectedError) {
        // Surface the friendly userMessage — never the raw provider reason.
        throw new UnprocessableEntityException(err.userMessage);
      }
      throw err;
    }

    // Best-effort eager wallet provisioning (same as /kyc/complete WN-3)
    try {
      await this.walletService.provisionAllEnabledNetworks(userId);
    } catch (err) {
      this.logger.warn(
        `WN-3: eager wallet provisioning failed for user ${userId} (submit) — ` +
          `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { userId, status: 'verified' };
  }

  /**
   * Set the transaction PIN for an already-verified user who has no PIN yet
   * (verified-but-PIN-less recovery). Distinct from /kyc/submit: it carries no
   * identity fields. JWT-authenticated; the service gates it to verified,
   * PIN-less users server-side (CLAUDE.md §3.3).
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
