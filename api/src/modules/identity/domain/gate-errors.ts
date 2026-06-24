/**
 * Domain error hierarchy for the server-side KYC / velocity / limit gate (§3.3).
 *
 * Pure domain — NO Nest, NO Prisma, NO external imports.
 * Each error carries a stable `code` string so callers can switch on type without
 * instanceof gymnastics across module boundaries.
 */

export abstract class GateError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (needed when target < ES2022 transpiles classes).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** User's SIM / phone number changed and re-verification + step-up has not completed. */
export class SimSwapBlockedError extends GateError {
  readonly code = 'SIM_SWAP_BLOCKED' as const;

  constructor() {
    super(
      'Transaction blocked: a SIM swap was detected on this account. ' +
        'Please complete re-verification and step-up authentication.',
    );
  }
}

/** User's KYC status is not verified, or their tier is unverified. */
export class KycNotVerifiedError extends GateError {
  readonly code = 'KYC_NOT_VERIFIED' as const;

  constructor(reason: 'status' | 'tier') {
    super(
      reason === 'status'
        ? 'Transaction blocked: KYC verification is required before transacting.'
        : 'Transaction blocked: account tier is unverified. Complete KYC to proceed.',
    );
  }
}

/** The requested fiat amount exceeds the per-transaction limit for the user's KYC tier. */
export class TierLimitExceededError extends GateError {
  readonly code = 'TIER_LIMIT_EXCEEDED' as const;

  constructor(
    readonly requestedAmount: number,
    readonly limitAmount: number,
    readonly tier: string,
  ) {
    super(
      `Transaction blocked: requested amount ${requestedAmount} NGN exceeds ` +
        `the per-transaction limit of ${limitAmount} NGN for tier ${tier}.`,
    );
  }
}

/** Daily spend or transaction count would exceed the user's velocity cap for their KYC tier. */
export class VelocityExceededError extends GateError {
  readonly code = 'VELOCITY_EXCEEDED' as const;

  constructor(
    readonly kind: 'fiat' | 'count',
    readonly used: number,
    readonly limit: number,
    readonly tier: string,
  ) {
    super(
      kind === 'fiat'
        ? `Transaction blocked: daily spend of ${used} NGN would exceed the ` +
            `daily limit of ${limit} NGN for tier ${tier}.`
        : `Transaction blocked: daily transaction count of ${used} would exceed ` +
            `the daily limit of ${limit} for tier ${tier}.`,
    );
  }
}
