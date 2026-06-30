/**
 * Domain errors for the set-PIN-for-verified-user flow (Finding: verified-but-
 * PIN-less recovery). Pure domain — NO Nest, NO Prisma. Each carries a stable
 * `code` so the global filter / controller can map it without instanceof
 * gymnastics across module boundaries (CLAUDE.md §4.1).
 */

export abstract class PinSetupError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (needed when target < ES2022 transpiles classes).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Set-PIN was requested for a user who is not KYC-verified. The PIN belongs to
 * the verified-account state; an unverified user must finish KYC first (which
 * already bundles PIN setup via /kyc/submit).
 */
export class PinSetupNotVerifiedError extends PinSetupError {
  readonly code = 'PIN_SETUP_NOT_VERIFIED' as const;

  constructor() {
    super('Complete KYC verification before setting a transaction PIN.');
  }
}

/**
 * Set-PIN was requested for a user who already has a PIN. Replacing an existing
 * PIN must go through a step-up-authenticated reset flow, never this idempotent
 * first-set path — so this endpoint refuses to overwrite.
 */
export class PinAlreadySetError extends PinSetupError {
  readonly code = 'PIN_ALREADY_SET' as const;

  constructor() {
    super('A transaction PIN is already set for this account.');
  }
}
