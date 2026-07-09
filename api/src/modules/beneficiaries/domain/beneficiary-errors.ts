/**
 * Domain errors for the beneficiary module.
 *
 * Pure — no Nest, no Prisma. Follows the same pattern as pin-errors.ts,
 * gate-errors.ts, etc. (root CLAUDE.md §4.1).
 */

/**
 * Thrown by BeneficiaryService.addCryptoAddress when the supplied address
 * fails AssetRegistry.validateAddress for the given network.
 */
export class InvalidAddressError extends Error {
  override readonly name = 'InvalidAddressError';
  readonly code = 'BENEFICIARY_INVALID_ADDRESS' as const;

  constructor(network: string, address: string) {
    super(
      `Address "${address}" is not valid for network "${network}". ` +
        'Please check the address and try again.',
    );
  }
}

/**
 * Thrown by BeneficiaryService.getById when the requested beneficiary does not
 * exist for the given userId (including soft-deleted rows).
 */
export class BeneficiaryNotFoundError extends Error {
  override readonly name = 'BeneficiaryNotFoundError';
  readonly code = 'BENEFICIARY_NOT_FOUND' as const;

  constructor(beneficiaryId: string) {
    super(`Beneficiary "${beneficiaryId}" not found.`);
  }
}

/**
 * Thrown by createSendProposal when the beneficiary is found but is not of
 * type `crypto_address` (e.g. a bank_account beneficiary was passed for a send).
 */
export class BeneficiaryWrongTypeError extends Error {
  override readonly name = 'BeneficiaryWrongTypeError';
  readonly code = 'BENEFICIARY_WRONG_TYPE' as const;

  constructor(beneficiaryId: string, expected: string, actual: string) {
    super(
      `Beneficiary "${beneficiaryId}" is type "${actual}", expected "${expected}".`,
    );
  }
}

/**
 * Thrown by createSellProposal when the chosen bank beneficiary's payout
 * currency does not match the sell's fiat currency (e.g. a user sells for GHS
 * but the beneficiary is an NGN bank). A cross-currency payout would settle to
 * the wrong rail — block it and prompt for a matching-currency bank.
 * Mapped to 422 like BeneficiaryWrongTypeError.
 */
export class BeneficiaryCurrencyMismatchError extends Error {
  override readonly name = 'BeneficiaryCurrencyMismatchError';
  readonly code = 'BENEFICIARY_CURRENCY_MISMATCH' as const;

  constructor(beneficiaryId: string, expected: string, actual: string) {
    super(
      `Beneficiary "${beneficiaryId}" pays out in "${actual}", expected "${expected}".`,
    );
  }
}

/**
 * Thrown by BeneficiaryService.listBanks when the requested country is not a
 * known catalog country (no fiat maps to it). Mapped to 422.
 */
export class UnknownBankCountryError extends Error {
  override readonly name = 'UnknownBankCountryError';
  readonly code = 'BENEFICIARY_UNKNOWN_COUNTRY' as const;

  constructor(country: string) {
    super(`"${country}" is not a supported bank country.`);
  }
}

/**
 * Thrown by createSendProposal when the beneficiary's first-use cooling-off
 * window has not yet expired (IDN-08). The send must be blocked until the
 * cooling-off period passes.
 */
export class BeneficiaryCoolingOffError extends Error {
  override readonly name = 'BeneficiaryCoolingOffError';
  readonly code = 'BENEFICIARY_COOLING_OFF' as const;

  constructor(beneficiaryId: string, lockedUntil: Date) {
    super(
      `Beneficiary "${beneficiaryId}" is in cooling-off until ${lockedUntil.toISOString()}. ` +
        'Please try again after the cooling-off period.',
    );
  }
}

/**
 * Thrown by BeneficiaryService.addBankAccount when the account number does not
 * match the precise format for the beneficiary's resolved country (e.g. a
 * 9-digit number for NG, whose NUBAN is exactly 10 digits). The wire DTO is
 * deliberately permissive (digits, length range) because it validates BEFORE the
 * country is derived from the currency; the country-specific check is the
 * server-side security gate (§3.3). Mapped to 422.
 */
export class BeneficiaryInvalidAccountNumberError extends Error {
  override readonly name = 'BeneficiaryInvalidAccountNumberError';
  readonly code = 'BENEFICIARY_INVALID_ACCOUNT_NUMBER' as const;

  constructor(country: string, accountNumber: string) {
    super(
      `Account number "${accountNumber}" is not a valid format for country "${country}".`,
    );
  }
}

/**
 * Thrown by BeneficiaryService.addBankAccount when the name-enquiry provider
 * cannot resolve the account (account not found, bank unreachable, invalid
 * number). No beneficiary is persisted — the caller must surface the error.
 */
export class NameEnquiryFailedError extends Error {
  override readonly name = 'NameEnquiryFailedError';
  readonly code = 'BENEFICIARY_NAME_ENQUIRY_FAILED' as const;

  constructor(
    bankCode: string,
    accountNumber: string,
    reason: string = 'account not found',
  ) {
    super(
      `Name enquiry failed for account ${accountNumber} at bank ${bankCode}: ${reason}.`,
    );
  }
}
