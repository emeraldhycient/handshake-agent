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
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
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
import { WalletService } from '../../wallets/application/wallet.service';
import { KycCompleteDto } from './dto/kyc-complete.dto';

@Controller('kyc')
@UseGuards(ThrottlerGuard)
export class KycController {
  private readonly logger = new Logger(KycController.name);

  constructor(
    private readonly handoffTokenService: HandoffTokenService,
    private readonly kycService: KycService,
    private readonly walletService: WalletService,
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
        throw new UnprocessableEntityException(err.message);
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
}
