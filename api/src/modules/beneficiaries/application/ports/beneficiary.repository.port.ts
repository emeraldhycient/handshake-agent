/**
 * Port: beneficiary repository.
 *
 * Application depends on this abstraction; infrastructure provides the
 * Prisma adapter. Follows the same Symbol-token + interface pattern used
 * throughout the codebase (e.g. identity.repository.port.ts).
 */

/** DI token for the beneficiary repository. */
export const BENEFICIARY_REPOSITORY = Symbol('BENEFICIARY_REPOSITORY');

// ---------------------------------------------------------------------------
// Application-level record type — NOT the Prisma-generated type
// ---------------------------------------------------------------------------

/**
 * Beneficiary record as exposed to the application layer. Infrastructure maps
 * Prisma rows to this shape; the application/agent layer never sees Prisma.
 */
export interface BeneficiaryRecord {
  id: string;
  userId: string;
  type: 'bank_account' | 'crypto_address';
  label: string;
  // Bank-account fields
  accountNumber: string | null;
  accountHolderName: string | null;
  bankCode: string | null;
  // Crypto-address fields
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
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface AddBankAccountInput {
  userId: string;
  accountNumber: string;
  bankCode: string;
  /** Resolved account-holder name (from the bank name-enquiry — not caller-supplied). */
  accountName: string;
  label: string;
  /**
   * Timestamp at which the name-enquiry resolved the account (Fix E).
   * Infrastructure must persist this as `verifiedAt` and set
   * `verificationStatus` to `verified`. Passing it from the application layer
   * (rather than letting the repository set it) keeps the timestamp consistent
   * with what was shown to the user at confirmation time.
   */
  verifiedAt: Date;
}

export interface AddCryptoAddressInput {
  userId: string;
  address: string;
  network: string;
  asset: string;
  label: string;
  firstUseLockedUntil: Date;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface IBeneficiaryRepository {
  /**
   * Lists all active (not soft-deleted) beneficiaries for the user, filtered by type.
   */
  listForUser(
    userId: string,
    type: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord[]>;

  /**
   * Creates a new bank-account beneficiary. Sets isDefault if the user has no
   * existing bank-account beneficiaries.
   */
  addBankAccount(input: AddBankAccountInput): Promise<BeneficiaryRecord>;

  /**
   * Creates a new crypto-address beneficiary with a first-use cooling-off expiry.
   */
  addCryptoAddress(input: AddCryptoAddressInput): Promise<BeneficiaryRecord>;

  /**
   * Returns the beneficiary for the given userId + id, or null if not found
   * (including soft-deleted rows).
   */
  getById(
    userId: string,
    beneficiaryId: string,
  ): Promise<BeneficiaryRecord | null>;

  /**
   * Returns the default beneficiary of the given type for the user, or null if
   * none is set.
   */
  getDefault(
    userId: string,
    type: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord | null>;

  // ── Admin oversight (Phase 3, sub-area D) ───────────────────────────────────

  /**
   * Lists active (not soft-deleted) beneficiaries across ALL users, newest-first,
   * capped at `page.limit`. Used by the admin beneficiary-oversight surface; the
   * per-user `listForUser` is the end-user path.
   */
  listAll(page: { limit: number }): Promise<BeneficiaryRecord[]>;

  /**
   * Returns the beneficiary by id alone (no user scoping), or null when absent
   * or soft-deleted. Used by the admin cooling-off override.
   */
  findById(beneficiaryId: string): Promise<BeneficiaryRecord | null>;

  /**
   * Clears a beneficiary's first-use cooling-off lock (sets
   * `firstUseLockedUntil = null`). The admin override; the full trail lives in
   * the AuditLog. Never moves money (§3.1).
   */
  clearCoolingOff(beneficiaryId: string): Promise<void>;
}
