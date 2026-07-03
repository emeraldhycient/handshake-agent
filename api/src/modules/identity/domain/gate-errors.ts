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
    readonly fiatCurrency: string,
  ) {
    super(
      `Transaction blocked: requested amount ${requestedAmount} ${fiatCurrency} exceeds ` +
        `the per-transaction limit of ${limitAmount} ${fiatCurrency} for tier ${tier}.`,
    );
  }
}

/**
 * The requested on-chain (crypto-address) send exceeds the single-send cap for the
 * user's KYC tier (`perSendOnChainFiatMax`). Separate from TierLimitExceededError so an
 * irreversible-send cap is legible in logs/audits distinct from the general per-tx cap.
 */
export class OnChainSendLimitExceededError extends GateError {
  readonly code = 'SEND_LIMIT_EXCEEDED' as const;

  constructor(
    readonly requestedAmount: number,
    readonly limitAmount: number,
    readonly tier: string,
    readonly fiatCurrency: string,
  ) {
    super(
      `Transaction blocked: on-chain send of ${requestedAmount} ${fiatCurrency} exceeds ` +
        `the single on-chain send limit of ${limitAmount} ${fiatCurrency} for tier ${tier}.`,
    );
  }
}

/**
 * The user's KYC tier changed recently and is still inside the cooling-off window
 * (`compliance.tierChangeCoolingOffSeconds`) — money moves are held to blunt abuse of a
 * freshly-granted tier on a possibly-compromised account (§3.3).
 */
export class TierChangeCoolingOffError extends GateError {
  readonly code = 'TIER_CHANGE_COOLING_OFF' as const;

  constructor(
    readonly holdUntil: Date,
    readonly tier: string,
  ) {
    super(
      `Transaction blocked: a tier-change cooling-off is in effect for tier ${tier} ` +
        `until ${holdUntil.toISOString()}.`,
    );
  }
}

/**
 * A velocity cap for the user's KYC tier would be exceeded:
 *  - `fiat`   → rolling 24-hour spend cap (`dailyFiatMax`)
 *  - `count`  → rolling 24-hour transaction-count cap (`dailyTxCountMax`)
 *  - `weekly` → rolling 7-day spend cap (`weeklyFiatMax`)
 */
export class VelocityExceededError extends GateError {
  readonly code = 'VELOCITY_EXCEEDED' as const;

  constructor(
    readonly kind: 'fiat' | 'count' | 'weekly',
    readonly used: number,
    readonly limit: number,
    readonly tier: string,
    readonly fiatCurrency: string,
  ) {
    super(VelocityExceededError.messageFor(kind, used, limit, tier, fiatCurrency));
  }

  private static messageFor(
    kind: 'fiat' | 'count' | 'weekly',
    used: number,
    limit: number,
    tier: string,
    fiatCurrency: string,
  ): string {
    if (kind === 'count') {
      return (
        `Transaction blocked: daily transaction count of ${used} would exceed ` +
        `the daily limit of ${limit} for tier ${tier}.`
      );
    }
    const window = kind === 'weekly' ? 'weekly' : 'daily';
    return (
      `Transaction blocked: ${window} spend of ${used} ${fiatCurrency} would exceed the ` +
      `${window} limit of ${limit} ${fiatCurrency} for tier ${tier}.`
    );
  }
}
