/**
 * Profile-settings domain errors (Wave C). Pure module — no Nest, no Prisma.
 * Stable `code` mirrors the pin-errors pattern (cross-boundary discriminant).
 */

/** The requested display/settlement fiat is not enabled in the live catalog. */
export class FiatCurrencyNotEnabledError extends Error {
  readonly code = 'FIAT_CURRENCY_NOT_ENABLED' as const;

  constructor(readonly currency: string) {
    super(`Currency ${currency} is not enabled on this account.`);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The session does not exist, is not owned by the caller, or is not active. */
export class ProfileSessionNotFoundError extends Error {
  readonly code = 'PROFILE_SESSION_NOT_FOUND' as const;

  constructor() {
    super('Session not found.');
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
