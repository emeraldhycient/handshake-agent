/**
 * BeneficiaryService — application-layer use-case service (S3 + Fix E).
 *
 * Manages saved payout destinations: bank accounts (sell) and crypto addresses
 * (send, Task N2). Clean-architecture invariants:
 *
 *   - No Prisma import, no @prisma/client, no direct DB access.
 *   - Injects IBeneficiaryRepository, INameEnquiry, and AssetRegistry via DI
 *     tokens / class ref.
 *   - Domain errors (InvalidAddressError, BeneficiaryNotFoundError,
 *     NameEnquiryFailedError) are pure.
 *   - Bank-account adds call the name-enquiry port and persist the RESOLVED
 *     name + verifiedAt. On enquiry failure no beneficiary is saved (Fix E).
 *   - Crypto adds carry first-use cooling-off (IDN-08) and address validation;
 *     name-enquiry is NOT called for crypto (unaffected, Fix E).
 *   - Step-up-on-add is a noted hardening follow-up (Flow E2E + cooling-off
 *     provide interim protection per S3 brief).
 *
 * CLAUDE.md §3.2: no @prisma/client here. dependency-cruiser enforces this.
 */

import { Injectable, Inject } from '@nestjs/common';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import {
  BENEFICIARY_REPOSITORY,
  type IBeneficiaryRepository,
  type BeneficiaryRecord,
} from './ports/beneficiary.repository.port';
import {
  BANK_NAME_ENQUIRY,
  type INameEnquiry,
} from './ports/name-enquiry.port';
import {
  InvalidAddressError,
  BeneficiaryNotFoundError,
} from '../domain/beneficiary-errors';

// ---------------------------------------------------------------------------
// Input types (application layer — no Prisma shapes)
// ---------------------------------------------------------------------------

export interface AddBankAccountInput {
  userId: string;
  accountNumber: string;
  bankCode: string;
  /**
   * Caller-supplied account holder name. Optional and IGNORED — the resolved
   * name from the name-enquiry port is what gets persisted (Fix E). Kept for
   * call sites (e.g. the WhatsApp Flow) that already pass it.
   */
  accountName?: string;
  /** User-supplied display label. */
  label: string;
}

export interface AddCryptoAddressInput {
  userId: string;
  address: string;
  network: string;
  asset: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class BeneficiaryService {
  /**
   * Default crypto cooling-off period in seconds (IDN-08).
   * Overridden by `beneficiary.cryptoCoolingOffSeconds` in config.
   */
  private static readonly DEFAULT_COOLING_OFF_SECONDS = 24 * 60 * 60; // 24 h

  constructor(
    @Inject(BENEFICIARY_REPOSITORY)
    private readonly repo: IBeneficiaryRepository,
    @Inject(BANK_NAME_ENQUIRY)
    private readonly nameEnquiry: INameEnquiry,
    private readonly assetRegistry: AssetRegistry,
    private readonly configService: EffectiveConfigService,
  ) {}

  // ── listForUser ────────────────────────────────────────────────────────────

  /**
   * Lists all active (non-deleted) beneficiaries of the given type for a user.
   */
  async listForUser(
    userId: string,
    type: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord[]> {
    return this.repo.listForUser(userId, type);
  }

  // ── addBankAccount ─────────────────────────────────────────────────────────

  /**
   * Persists a new bank-account beneficiary after resolving the account-holder
   * name via the name-enquiry port (Fix E).
   *
   * Flow:
   *   1. Call INameEnquiry.resolve(bankCode, accountNumber) — may throw
   *      NameEnquiryFailedError on an invalid/not-found account.
   *   2. Persist the RESOLVED accountName (not the caller-supplied name) and
   *      set verifiedAt to now.
   *   3. The repository sets verificationStatus to 'verified'.
   *
   * Sets `isDefault` automatically if the user has no existing bank accounts.
   * Crypto-address beneficiaries are unaffected — name-enquiry is not called.
   *
   * @throws {NameEnquiryFailedError} when the name-enquiry provider cannot
   *         resolve the account. No beneficiary is persisted in that case.
   */
  async addBankAccount(input: AddBankAccountInput): Promise<BeneficiaryRecord> {
    // Resolve the account-holder name from the bank (fails-closed on error).
    const enquiryResult = await this.nameEnquiry.resolve({
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
    });

    return this.repo.addBankAccount({
      userId: input.userId,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      // Use the bank-resolved name, not the caller-supplied name (Fix E).
      accountName: enquiryResult.accountName,
      label: input.label,
      verifiedAt: new Date(),
    });
  }

  // ── addCryptoAddress ───────────────────────────────────────────────────────

  /**
   * Validates the address against the network's pattern (via AssetRegistry),
   * then persists the beneficiary with a first-use cooling-off expiry (IDN-08).
   *
   * @throws {InvalidAddressError} when the address fails network validation.
   *
   * NOTE: Step-up-on-add (step-up PIN challenge before persisting) is a hardening
   * follow-up noted in the S3 brief. The Flow E2E encryption + cooling-off window
   * provide interim protection.
   */
  async addCryptoAddress(
    input: AddCryptoAddressInput,
  ): Promise<BeneficiaryRecord> {
    const valid = this.assetRegistry.validateAddress(
      input.network,
      input.address,
    );
    if (!valid) {
      throw new InvalidAddressError(input.network, input.address);
    }

    const coolingOffSeconds = this.getCoolingOffSeconds();
    const firstUseLockedUntil = new Date(Date.now() + coolingOffSeconds * 1000);

    return this.repo.addCryptoAddress({
      userId: input.userId,
      address: input.address,
      network: input.network,
      asset: input.asset,
      label: input.label,
      firstUseLockedUntil,
    });
  }

  // ── getById ────────────────────────────────────────────────────────────────

  /**
   * Returns the beneficiary for the user, or null when not found.
   * Soft-deleted rows are excluded.
   */
  async getById(
    userId: string,
    beneficiaryId: string,
  ): Promise<BeneficiaryRecord | null> {
    return this.repo.getById(userId, beneficiaryId);
  }

  // ── getDefault ─────────────────────────────────────────────────────────────

  /**
   * Returns the user's default beneficiary of the given type, or null.
   */
  async getDefault(
    userId: string,
    type: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord | null> {
    return this.repo.getDefault(userId, type);
  }

  // ── requireById ───────────────────────────────────────────────────────────

  /**
   * Like getById but throws BeneficiaryNotFoundError when not found.
   * Useful in the Flow controller where absence should return an error screen.
   */
  async requireById(
    userId: string,
    beneficiaryId: string,
  ): Promise<BeneficiaryRecord> {
    const ben = await this.repo.getById(userId, beneficiaryId);
    if (!ben) {
      throw new BeneficiaryNotFoundError(beneficiaryId);
    }
    return ben;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private getCoolingOffSeconds(): number {
    // Config is read at call time (not constructor) so DB-admin AppSetting
    // overrides take effect at runtime via EffectiveConfigService (root §7).
    const fromConfig: unknown = this.configService.get(
      'beneficiary.cryptoCoolingOffSeconds',
    );
    if (typeof fromConfig === 'number' && fromConfig > 0) {
      return fromConfig;
    }
    return BeneficiaryService.DEFAULT_COOLING_OFF_SECONDS;
  }
}
