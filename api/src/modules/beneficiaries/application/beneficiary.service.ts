/**
 * BeneficiaryService — application-layer use-case service (S3).
 *
 * Manages saved payout destinations: bank accounts (sell) and crypto addresses
 * (send, Task N2). Clean-architecture invariants:
 *
 *   - No Prisma import, no @prisma/client, no direct DB access.
 *   - Injects IBeneficiaryRepository and AssetRegistry via DI tokens / class ref.
 *   - Domain errors (InvalidAddressError, BeneficiaryNotFoundError) are pure.
 *   - Crypto adds carry first-use cooling-off (IDN-08) and address validation.
 *   - Step-up-on-add is a noted hardening follow-up (Flow E2E + cooling-off provide
 *     interim protection per S3 brief).
 *
 * CLAUDE.md §3.2: no @prisma/client here. dependency-cruiser enforces this.
 */

import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { Env } from '../../../core/config/env.schema';
import {
  BENEFICIARY_REPOSITORY,
  type IBeneficiaryRepository,
  type BeneficiaryRecord,
} from './ports/beneficiary.repository.port';
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
  /** Full account holder name as returned by the bank. */
  accountName: string;
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
    private readonly assetRegistry: AssetRegistry,
    private readonly configService: ConfigService<Env, true>,
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
   * Persists a new bank-account beneficiary.
   * Sets `isDefault` automatically if the user has no existing bank accounts.
   * Verification status starts at `pending` (resolved skeleton; a real bank
   * name-enquiry adapter would drive it to `verified`).
   */
  async addBankAccount(input: AddBankAccountInput): Promise<BeneficiaryRecord> {
    return this.repo.addBankAccount({
      userId: input.userId,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      accountName: input.accountName,
      label: input.label,
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
    // Config is read at call time (not constructor) so DB-admin overrides apply.
    // The key is a non-Env nested path; cast to unknown first then narrow at runtime.
    const fromConfig: unknown = this.configService.get(
      'beneficiary.cryptoCoolingOffSeconds' as keyof Env,
    );
    if (typeof fromConfig === 'number' && fromConfig > 0) {
      return fromConfig;
    }
    return BeneficiaryService.DEFAULT_COOLING_OFF_SECONDS;
  }
}
