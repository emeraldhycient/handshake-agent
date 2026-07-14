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

/**
 * The caller tried to write POST /profile/name after KYC verification has
 * started. The name is verified against NIN/BVN at KYC time and is relied on
 * as the immutable FATF Travel-Rule originator identity (execution.service.ts
 * reads it as immutable, without re-locking, right before the settlement
 * write) — allowing a write here for any status past `not_started` would let
 * a verified user silently overwrite their verified name with no PIN, no
 * step-up, and no audit trail.
 */
export class NameChangeNotAllowedError extends Error {
  readonly code = 'NAME_CHANGE_NOT_ALLOWED' as const;

  constructor() {
    super('Your name is locked once identity verification has started.');
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
