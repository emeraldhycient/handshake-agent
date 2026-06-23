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

  constructor(beneficiaryId: string) {
    super(`Beneficiary "${beneficiaryId}" not found.`);
  }
}
