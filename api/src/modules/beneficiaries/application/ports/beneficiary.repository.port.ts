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
  /** ISO 4217 payout currency (bank rows); null on crypto rows. */
  payoutCurrency: string | null;
  /** ISO 3166-1 alpha-2 bank country (bank rows); null on crypto rows. */
  bankCountry: string | null;
  // Crypto-address fields
  cryptoAddress: string | null;
  cryptoAsset: string | null;
  cryptoNetwork: string | null;
  verificationStatus: string;
  /**
   * Payout rail for a bank beneficiary ('bank' default | 'mobile_money').
   * Optional on the record type so pre-existing test fixtures need not set it;
   * the repository always populates it from the (non-null, defaulted) column.
   */
  rail?: 'bank' | 'mobile_money';
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
  /**
   * The account-holder name to persist: the bank-RESOLVED name where the
   * country's name-enquiry rail runs (NG), or the user-entered name where it
   * does not (the row is then saved `unverified`).
   */
  accountName: string;
  label: string;
  /** ISO 4217 payout currency (e.g. 'NGN') — derived from the request currency. */
  payoutCurrency: string;
  /** ISO 3166-1 alpha-2 bank country (e.g. 'NG') — derived server-side from the currency. */
  bankCountry: string;
  /** Payout rail ('bank' default | 'mobile_money'); defaults to 'bank' when omitted. */
  rail?: 'bank' | 'mobile_money';
  /**
   * Verification lifecycle to persist: `'verified'` when the name-enquiry
   * resolved the account, `'unverified'` when the rail could not resolve it
   * (non-NG today) and the user-entered name was kept.
   */
  verificationStatus: 'verified' | 'unverified';
  /**
   * Timestamp at which the name-enquiry resolved the account (Fix E); `null`
   * when the account was saved unverified (no enquiry ran). Passing it from the
   * application layer keeps the timestamp consistent with what was shown at
   * confirmation time.
   */
  verifiedAt: Date | null;
  /**
   * First-use cooling-off expiry to persist (B3). Set for an `unverified` bank
   * add (name-enquiry unavailable for the market) so an unverified name cannot
   * go straight onto a real transfer; `null`/omitted for a verified account.
   */
  firstUseLockedUntil?: Date | null;
}

export interface AddCryptoAddressInput {
  userId: string;
  address: string;
  network: string;
  asset: string;
  label: string;
  firstUseLockedUntil: Date;
}

/**
 * Identifier used to detect a duplicate active beneficiary at add-time.
 * For bank accounts: (accountNumber, bankCode). For crypto addresses: the
 * on-chain address. The repository scopes the match by userId + type +
 * deletedAt IS NULL.
 */
export type DuplicateLookup =
  | { type: 'bank_account'; accountNumber: string; bankCode: string }
  | { type: 'crypto_address'; cryptoAddress: string };

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

  /**
   * Finds the user's active (not soft-deleted) beneficiaries whose label
   * matches `label` case-insensitively (EXACT match, not substring), optionally
   * filtered by type. Returns ALL matches ordered isDefault desc, createdAt asc
   * so callers can distinguish one hit (use it) from many (ask the user).
   *
   * SECURITY (CLAUDE.md §3.1): this is the nickname-resolution lookup — the
   * label is a lookup key scoped to the user's own saved beneficiaries; it
   * never resolves an address/account number from free text.
   */
  findByLabel(
    userId: string,
    label: string,
    type?: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord[]>;

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
  /**
   * Returns the active (non-deleted) beneficiary matching the identifier for the
   * user, or null if none. Used to dedupe at add-time so re-adding the same
   * account/address reuses the existing row instead of inserting a duplicate
   * (which would reset the first-use cooling-off clock).
   */
  findActiveDuplicate(
    userId: string,
    lookup: DuplicateLookup,
  ): Promise<BeneficiaryRecord | null>;

  /**
   * Soft-deletes the beneficiary (sets `deletedAt`) for the given userId + id.
   * Returns true when a row was deleted, false when no active row matched
   * (already deleted or not owned by the user). Idempotent: deleting an
   * already-deleted row returns false without error.
   */
  softDelete(userId: string, beneficiaryId: string): Promise<boolean>;
}
