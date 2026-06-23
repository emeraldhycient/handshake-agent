/**
 * KYC web-handoff endpoint (K3).
 *
 * POST /kyc/complete — public endpoint (no JWT required; security is via the
 * single-use HandoffToken). Throttled to prevent brute-force.
 *
 * Flow:
 *   1. Consume the single-use HandoffToken → resolve channelAddress.
 *   2. Call KycService.completeVerification with the submitted identity data.
 *   3. Return { userId, status: 'verified' }.
 *
 * Error mapping:
 *   - HandoffTokenNotFoundError / HandoffTokenExpiredError / HandoffTokenWrongPurposeError → 400
 *   - ContactNotFoundError → 400
 *   - KycRejectedError → 422
 *
 * Architecture: presentation layer only — no Prisma, no domain logic, no agent.
 * Imports through application ports only (CLAUDE.md §4.1).
 */

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { KycCompleteResponse } from '@handshake-agent/contracts';

import { HandoffTokenDomainError } from '../domain/handoff-token-errors';
import { ContactNotFoundError, KycRejectedError } from '../domain/kyc-errors';
import { HandoffTokenService } from '../application/handoff-token.service';
import { KycService } from '../application/kyc.service';
import { KycCompleteDto } from './dto/kyc-complete.dto';

@Controller('kyc')
@UseGuards(ThrottlerGuard)
export class KycController {
  constructor(
    private readonly handoffTokenService: HandoffTokenService,
    private readonly kycService: KycService,
  ) {}

  /**
   * Redeem a single-use KYC handoff token and complete identity verification.
   *
   * Public endpoint — secured by the single-use token (≥256-bit CSPRNG) and
   * rate-limited by ThrottlerGuard. No JWT required — the token IS the credential.
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
    try {
      const { userId } = await this.kycService.completeVerification({
        channelAddress,
        nin: dto.nin,
        bvn: dto.bvn,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth,
        pin: dto.pin,
      });

      return { userId, status: 'verified' };
    } catch (err) {
      if (err instanceof ContactNotFoundError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof KycRejectedError) {
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    }
  }
}
