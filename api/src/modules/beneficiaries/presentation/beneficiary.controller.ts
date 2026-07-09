/**
 * BeneficiaryController — web (JWT-auth) CRUD for saved payout destinations.
 *
 *   GET  /beneficiaries?type=bank_account|crypto_address  → list
 *   GET  /beneficiaries/banks?country=<ISO>               → bank dropdown
 *   POST /beneficiaries/bank-account   {accountNumber,bankCode,label,currency,pin,…}
 *   POST /beneficiaries/crypto-address {address,network,asset,label,pin,…}
 *
 * Reuses BeneficiaryService (the same engine the WhatsApp Flow surface uses):
 *   - bank-account add runs country-gated name-enquiry (resolved name persisted
 *     where the rail supports it; user-entered name saved unverified otherwise).
 *   - crypto-address add runs address-pattern validation + first-use cooling-off.
 *
 * Security (CLAUDE.md §3.2 / §3.3 / §3.4): presentation layer only — no Prisma,
 * no domain logic. JwtAuthGuard on every route; the userId comes from the
 * verified session, never the request body. Adding a withdrawal destination is
 * step-up gated (audit R2): PIN verify (lockout-protected) + a device-bound
 * step-up recorded BEFORE the service persists. Domain errors map to 4xx so the
 * client sees a clear message without leaking internals.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';

import type {
  Beneficiary,
  BeneficiaryListResponse,
  BankListResponse,
  DeleteBeneficiaryResponse,
} from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { PinService } from '../../../core/auth/pin.service';
import { SessionService } from '../../../core/auth/session.service';
import { StepUpRequiredError } from '../../../core/auth/domain/session-errors';

import { BeneficiaryService } from '../application/beneficiary.service';
import type { BeneficiaryRecord } from '../application/ports/beneficiary.repository.port';
import {
  NameEnquiryFailedError,
  InvalidAddressError,
  BeneficiaryNotFoundError,
} from '../domain/beneficiary-errors';
import {
  ListBeneficiariesQueryDto,
  BankListQueryDto,
  AddBankAccountDto,
  AddCryptoAddressDto,
} from './dto/beneficiary.dto';

/**
 * Maps the application-layer BeneficiaryRecord to the wire DTO:
 * Date fields → ISO strings; internal fields (userId, verifiedAt, updatedAt,
 * deletedAt) are dropped — the client never needs them.
 */
function toBeneficiaryDto(record: BeneficiaryRecord): Beneficiary {
  return {
    id: record.id,
    type: record.type,
    label: record.label,
    accountNumber: record.accountNumber,
    accountHolderName: record.accountHolderName,
    bankCode: record.bankCode,
    currency: record.payoutCurrency,
    country: record.bankCountry,
    cryptoAddress: record.cryptoAddress,
    cryptoAsset: record.cryptoAsset,
    cryptoNetwork: record.cryptoNetwork,
    verificationStatus: record.verificationStatus,
    isDefault: record.isDefault,
    firstUseLockedUntil: record.firstUseLockedUntil
      ? record.firstUseLockedUntil.toISOString()
      : null,
    createdAt: record.createdAt.toISOString(),
  };
}

@Controller('beneficiaries')
@UseGuards(JwtAuthGuard)
export class BeneficiaryController {
  constructor(
    private readonly beneficiaryService: BeneficiaryService,
    private readonly pinService: PinService,
    private readonly sessionService: SessionService,
  ) {}

  @Get()
  async list(
    @Query() query: ListBeneficiariesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BeneficiaryListResponse> {
    const records = await this.beneficiaryService.listForUser(
      user.userId,
      query.type,
    );
    return { beneficiaries: records.map(toBeneficiaryDto) };
  }

  /**
   * Lists the banks for a country to back the add-bank dropdown. Real
   * Flutterwave `/banks/{country}` behind a per-country cache; unknown countries
   * are rejected (422) by the service before any provider call.
   */
  @Get('banks')
  async listBanks(@Query() query: BankListQueryDto): Promise<BankListResponse> {
    const banks = await this.beneficiaryService.listBanks(query.country);
    return { banks };
  }

  @Post('bank-account')
  @HttpCode(HttpStatus.CREATED)
  async addBankAccount(
    @Body() dto: AddBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Beneficiary> {
    // R2: PIN + device-bound step-up BEFORE persisting a withdrawal destination.
    await this.requireStepUpForAdd(user.userId, dto.pin, dto.deviceFingerprint);
    try {
      const record = await this.beneficiaryService.addBankAccount({
        userId: user.userId,
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
        label: dto.label,
        currency: dto.currency,
        // Persisted only where the rail cannot resolve the true name (non-NG).
        accountName: dto.accountHolderName,
      });
      return toBeneficiaryDto(record);
    } catch (err) {
      if (err instanceof NameEnquiryFailedError) {
        throw new UnprocessableEntityException(
          'Could not verify this bank account. Please check the account number and bank, then try again.',
        );
      }
      throw err;
    }
  }

  @Post('crypto-address')
  @HttpCode(HttpStatus.CREATED)
  async addCryptoAddress(
    @Body() dto: AddCryptoAddressDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Beneficiary> {
    // R2: PIN + device-bound step-up BEFORE persisting a withdrawal destination.
    // This is ADDITIONAL to the first-use cooling-off, not a replacement.
    await this.requireStepUpForAdd(user.userId, dto.pin, dto.deviceFingerprint);
    try {
      const record = await this.beneficiaryService.addCryptoAddress({
        userId: user.userId,
        address: dto.address,
        network: dto.network,
        asset: dto.asset,
        label: dto.label,
      });
      return toBeneficiaryDto(record);
    } catch (err) {
      if (err instanceof InvalidAddressError) {
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    }
  }

  /**
   * Step-up chain for adding a withdrawal destination (audit R2) — mirrors the
   * send money-path (executeSend): verify the PIN (lockout-protected) then record
   * a device-bound step-up. Fail-closed: PIN errors propagate (→ 401 via the
   * global filter); an unresolvable device throws STEP_UP_REQUIRED (→ 403) so no
   * destination is persisted without a traceable device binding (§3.4).
   */
  private async requireStepUpForAdd(
    userId: string,
    pin: string,
    deviceFingerprint: string | undefined,
  ): Promise<void> {
    // 1. Verify PIN first (its own atomic lockout). Throws Pin* domain errors.
    await this.pinService.verifyPin(userId, pin);

    // 2. Resolve the acting device: client fingerprint → else the pinned device.
    const deviceId =
      (await this.sessionService.findDeviceIdByFingerprint(
        userId,
        deviceFingerprint,
      )) ?? (await this.sessionService.findPinnedDeviceId(userId));

    // 3. No traceable device → cannot record a device-bound step-up (fail-closed).
    if (!deviceId) {
      throw new StepUpRequiredError('no_session');
    }

    // 4. Record the device-bound step-up (mirrors executeSend Step 7b).
    const now = new Date();
    await this.sessionService.startOrTouch(userId, deviceId);
    await this.sessionService.recordStepUp(userId, deviceId, now);
  }

  /**
   * Soft-deletes a saved beneficiary so it leaves the picker (a typo'd or stale
   * row can be removed). Scoped to the current user; a missing/foreign/already-
   * deleted id maps to 404 (never reveals ownership).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeleteBeneficiaryResponse> {
    try {
      return await this.beneficiaryService.delete(user.userId, id);
    } catch (err) {
      if (err instanceof BeneficiaryNotFoundError) {
        throw new NotFoundException('Beneficiary not found.');
      }
      throw err;
    }
  }
}
