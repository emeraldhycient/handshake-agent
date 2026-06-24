/**
 * Prisma adapter for IBeneficiaryRepository (S3).
 *
 * Infrastructure layer only — the only place @prisma/client / PrismaService
 * may be imported in the beneficiaries module (dependency-cruiser rule §3.2).
 *
 * Maps Prisma rows → application-layer BeneficiaryRecord. The application
 * service (BeneficiaryService) never sees Prisma types.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  IBeneficiaryRepository,
  BeneficiaryRecord,
  AddBankAccountInput,
  AddCryptoAddressInput,
} from '../application/ports/beneficiary.repository.port';

// Prisma 7 generates enums into the client namespace.
// Using string literals keeps the infrastructure portable.
type PrismaRow = {
  id: string;
  userId: string;
  type: string;
  label: string;
  accountNumber: string | null;
  accountHolderName: string | null;
  bankCode: string | null;
  cryptoAddress: string | null;
  cryptoAsset: string | null;
  cryptoNetwork: string | null;
  verificationStatus: string;
  firstUseLockedUntil: Date | null;
  verifiedAt: Date | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

/** Fields selected on every beneficiary query — avoids SELECT *. */
const SELECT = {
  id: true,
  userId: true,
  type: true,
  label: true,
  accountNumber: true,
  accountHolderName: true,
  bankCode: true,
  cryptoAddress: true,
  cryptoAsset: true,
  cryptoNetwork: true,
  verificationStatus: true,
  firstUseLockedUntil: true,
  verifiedAt: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

@Injectable()
export class BeneficiaryPrismaRepository implements IBeneficiaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(
    userId: string,
    type: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord[]> {
    const rows = await this.prisma.beneficiary.findMany({
      where: { userId, type: type as never, deletedAt: null },
      select: SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async addBankAccount(input: AddBankAccountInput): Promise<BeneficiaryRecord> {
    // Determine if this should be the default (first bank account for the user).
    const existing = await this.prisma.beneficiary.count({
      where: {
        userId: input.userId,
        type: 'bank_account' as never,
        deletedAt: null,
      },
    });
    const isDefault = existing === 0;

    const row = await this.prisma.beneficiary.create({
      data: {
        userId: input.userId,
        type: 'bank_account' as never,
        label: input.label,
        accountNumber: input.accountNumber,
        // accountName is now the bank-resolved name (Fix E: BeneficiaryService
        // calls INameEnquiry before this method; trusting the resolved name here).
        accountHolderName: input.accountName,
        bankCode: input.bankCode,
        // Persist as verified — the name-enquiry resolved successfully (Fix E).
        verificationStatus: 'verified' as never,
        verifiedAt: input.verifiedAt,
        isDefault,
      },
      select: SELECT,
    });

    return toRecord(row);
  }

  async addCryptoAddress(
    input: AddCryptoAddressInput,
  ): Promise<BeneficiaryRecord> {
    const existing = await this.prisma.beneficiary.count({
      where: {
        userId: input.userId,
        type: 'crypto_address' as never,
        deletedAt: null,
      },
    });
    const isDefault = existing === 0;

    const row = await this.prisma.beneficiary.create({
      data: {
        userId: input.userId,
        type: 'crypto_address' as never,
        label: input.label,
        cryptoAddress: input.address,
        cryptoAsset: input.asset as never,
        cryptoNetwork: input.network as never,
        firstUseLockedUntil: input.firstUseLockedUntil,
        verificationStatus: 'pending' as never,
        isDefault,
      },
      select: SELECT,
    });

    return toRecord(row);
  }

  async getById(
    userId: string,
    beneficiaryId: string,
  ): Promise<BeneficiaryRecord | null> {
    const row = await this.prisma.beneficiary.findFirst({
      where: { id: beneficiaryId, userId, deletedAt: null },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async getDefault(
    userId: string,
    type: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord | null> {
    const row = await this.prisma.beneficiary.findFirst({
      where: {
        userId,
        type: type as never,
        isDefault: true,
        deletedAt: null,
      },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }
}

// ---------------------------------------------------------------------------
// Private helper
// ---------------------------------------------------------------------------

function toRecord(row: PrismaRow): BeneficiaryRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as 'bank_account' | 'crypto_address',
    label: row.label,
    accountNumber: row.accountNumber,
    accountHolderName: row.accountHolderName,
    bankCode: row.bankCode,
    cryptoAddress: row.cryptoAddress,
    cryptoAsset: row.cryptoAsset,
    cryptoNetwork: row.cryptoNetwork,
    verificationStatus: row.verificationStatus,
    firstUseLockedUntil: row.firstUseLockedUntil,
    verifiedAt: row.verifiedAt,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}
