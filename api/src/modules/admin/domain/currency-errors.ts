/**
 * Runtime "Add currency" (CustomFiat) domain errors. Pure — no Nest, no Prisma.
 * Each carries a stable `code` so the global DomainExceptionFilter maps it to the
 * right HTTP status without importing these classes. Mirrors the SettingsError base.
 *
 * Note: enabling a currency without pricing is fail-closed via the SHARED
 * `MultiCurrencyInvariantError` (settings-errors.ts, ADMIN_MULTI_CURRENCY_INVARIANT
 * → 422) — the same "an enabled currency must have limits/pricing" invariant the
 * built-in fiats obey — so it is not re-declared here.
 */

export type CurrencyErrorCode = 'ADMIN_CURRENCY_COLLISION';

export abstract class CurrencyError extends Error {
  abstract readonly code: CurrencyErrorCode;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The proposed currency code already exists — it collides with a BUILT-IN catalog
 * fiat or an existing custom fiat. A custom fiat may never shadow a platform
 * currency (§3.3, server-side re-check). Maps to HTTP 409 Conflict.
 */
export class CurrencyCollisionError extends CurrencyError {
  readonly code = 'ADMIN_CURRENCY_COLLISION' as const;
  constructor(code: string) {
    super(`Currency code "${code}" already exists.`);
  }
}
