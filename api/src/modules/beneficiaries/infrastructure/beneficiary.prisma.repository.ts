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
  DuplicateLookup,
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
  payoutCurrency: string | null;
  bankCountry: string | null;
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
  payoutCurrency: true,
  bankCountry: true,
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
        // accountName is the bank-RESOLVED name where name-enquiry ran (NG),
        // else the user-entered name (non-NG, saved unverified) — the service
        // decides which before calling this method (country-gated name-enquiry).
        accountHolderName: input.accountName,
        bankCode: input.bankCode,
        payoutCurrency: input.payoutCurrency,
        bankCountry: input.bankCountry,
        // 'verified' when name-enquiry resolved the account; 'unverified' when
        // the country's rail could not resolve it (do NOT fail closed).
        verificationStatus: input.verificationStatus as never,
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

  async findByLabel(
    userId: string,
    label: string,
    type?: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord[]> {
    const rows = await this.prisma.beneficiary.findMany({
      where: {
        userId,
        deletedAt: null,
        // Case-insensitive EXACT match (equals, not contains) — "mum" must not
        // match "mum's friend".
        label: { equals: label, mode: 'insensitive' },
        ...(type ? { type: type as never } : {}),
      },
      select: SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRecord);
  }

  // ── Admin oversight (Phase 3, sub-area D) ───────────────────────────────────

  async listAll(page: { limit: number }): Promise<BeneficiaryRecord[]> {
    const rows = await this.prisma.beneficiary.findMany({
      where: { deletedAt: null },
      select: SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
    });
    return rows.map(toRecord);
  }

  async findById(beneficiaryId: string): Promise<BeneficiaryRecord | null> {
    const row = await this.prisma.beneficiary.findFirst({
      where: { id: beneficiaryId, deletedAt: null },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findActiveDuplicate(
    userId: string,
    lookup: DuplicateLookup,
  ): Promise<BeneficiaryRecord | null> {
    const where =
      lookup.type === 'bank_account'
        ? {
            userId,
            type: 'bank_account' as never,
            accountNumber: lookup.accountNumber,
            bankCode: lookup.bankCode,
            deletedAt: null,
          }
        : {
            userId,
            type: 'crypto_address' as never,
            cryptoAddress: lookup.cryptoAddress,
            deletedAt: null,
          };

    const row = await this.prisma.beneficiary.findFirst({
      where,
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async clearCoolingOff(beneficiaryId: string): Promise<void> {
    await this.prisma.beneficiary.update({
      where: { id: beneficiaryId },
      data: { firstUseLockedUntil: null },
    });
  }

  async softDelete(userId: string, beneficiaryId: string): Promise<boolean> {
    // updateMany (not update) so a non-matching id / wrong owner / already-deleted
    // row yields count 0 instead of throwing — ownership is enforced in the WHERE.
    const result = await this.prisma.beneficiary.updateMany({
      where: { id: beneficiaryId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
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
    payoutCurrency: row.payoutCurrency,
    bankCountry: row.bankCountry,
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
