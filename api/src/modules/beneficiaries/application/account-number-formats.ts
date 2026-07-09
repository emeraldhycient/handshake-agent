/**
 * Per-country bank-account-number formats (B1).
 *
 * The `AddBankAccountRequestSchema` wire DTO is deliberately permissive (digits
 * only, 8–20) because it validates BEFORE the server derives the country from
 * the payout currency. This module holds the PRECISE per-country rule enforced
 * server-side in `BeneficiaryService.addBankAccount` (§3.3) — the security gate.
 *
 * Owned by the beneficiaries application layer (NOT `core/config/configuration.ts`):
 * these are structural format facts about each market's rail, not an
 * ops-tunable business value. A country we do not explicitly model falls back to
 * the permissive DEFAULT so a new market never fails closed (mirrors the
 * name-enquiry "never fail closed on an unsupported market" philosophy).
 */

/** Inclusive digit-length band for an account number in a given market. */
export interface AccountNumberRule {
  readonly min: number;
  readonly max: number;
}

/**
 * Strict rules for markets we model precisely. Everything else uses DEFAULT.
 * NG = NUBAN, exactly 10 digits. Add a market here only when its format is
 * confidently known; a too-strict guess would reject legitimate accounts.
 */
const RULES_BY_COUNTRY: Readonly<Record<string, AccountNumberRule>> = {
  NG: { min: 10, max: 10 }, // NUBAN — exactly 10 digits
};

/**
 * Permissive fallback for markets we do not strictly model — broad enough to
 * reject obvious garbage (too short, non-digit) without rejecting valid foreign
 * accounts (e.g. a 13-digit GHS number). Aligned with the wire DTO band.
 */
const DEFAULT_RULE: AccountNumberRule = { min: 8, max: 20 };

/**
 * Returns the format rule for the resolved country (case-insensitive), or the
 * permissive default when the market is not explicitly modelled.
 */
export function accountNumberRuleForCountry(
  country: string,
): AccountNumberRule {
  return RULES_BY_COUNTRY[country.trim().toUpperCase()] ?? DEFAULT_RULE;
}

/**
 * True when `accountNumber` is all digits and its length is within the resolved
 * country's rule. The server-side account-number gate (§3.3).
 */
export function isValidAccountNumberForCountry(
  country: string,
  accountNumber: string,
): boolean {
  if (!/^\d+$/.test(accountNumber)) {
    return false;
  }
  const { min, max } = accountNumberRuleForCountry(country);
  return accountNumber.length >= min && accountNumber.length <= max;
}
