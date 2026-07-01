/**
 * BeneficiaryController — web (JWT-auth) CRUD for saved payout destinations.
 *
 *   GET  /beneficiaries?type=bank_account|crypto_address  → list
 *   POST /beneficiaries/bank-account   {accountNumber,bankCode,label}
 *   POST /beneficiaries/crypto-address {address,network,asset,label}
 *
 * Reuses BeneficiaryService (the same engine the WhatsApp Flow surface uses):
 *   - bank-account add runs the name-enquiry port (resolved name persisted).
 *   - crypto-address add runs address-pattern validation + first-use cooling-off.
 *
 * Security (CLAUDE.md §3.2 / §3.3): presentation layer only — no Prisma, no
 * domain logic. JwtAuthGuard on every route; the userId comes from the verified
 * session, never the request body. Domain errors map to 422 so the client can
 * surface a clear message without leaking internals.
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
  DeleteBeneficiaryResponse,
} from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';

import { BeneficiaryService } from '../application/beneficiary.service';
import type { BeneficiaryRecord } from '../application/ports/beneficiary.repository.port';
import {
  NameEnquiryFailedError,
  InvalidAddressError,
  BeneficiaryNotFoundError,
} from '../domain/beneficiary-errors';
import {
  ListBeneficiariesQueryDto,
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
  constructor(private readonly beneficiaryService: BeneficiaryService) {}

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

  @Post('bank-account')
  @HttpCode(HttpStatus.CREATED)
  async addBankAccount(
    @Body() dto: AddBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Beneficiary> {
    try {
      const record = await this.beneficiaryService.addBankAccount({
        userId: user.userId,
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
        label: dto.label,
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
