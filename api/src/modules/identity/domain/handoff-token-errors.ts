/**
 * Domain error hierarchy for HandoffToken operations (K3).
 *
 * Pure domain — NO Nest, NO Prisma, NO external imports.
 * Each error carries a stable `code` string so callers can switch on type
 * without instanceof gymnastics across module boundaries (CLAUDE.md §4.1).
 */

export abstract class HandoffTokenDomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (needed when target < ES2022 transpiles classes).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The token was not found, has already been redeemed, or has been revoked. */
export class HandoffTokenNotFoundError extends HandoffTokenDomainError {
  readonly code = 'HANDOFF_TOKEN_NOT_FOUND' as const;

  constructor() {
    super('HandoffToken not found or already consumed.');
  }
}

/** The token exists but has passed its expiresAt timestamp. */
export class HandoffTokenExpiredError extends HandoffTokenDomainError {
  readonly code = 'HANDOFF_TOKEN_EXPIRED' as const;

  constructor() {
    super('HandoffToken has expired.');
  }
}

/** The token exists but was issued for a different purpose. */
export class HandoffTokenWrongPurposeError extends HandoffTokenDomainError {
  readonly code = 'HANDOFF_TOKEN_WRONG_PURPOSE' as const;

  constructor(expected: string, actual: string) {
    super(
      `HandoffToken purpose mismatch: expected '${expected}', got '${actual}'.`,
    );
  }
}
