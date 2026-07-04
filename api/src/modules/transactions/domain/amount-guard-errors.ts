/**
 * Proposal-boundary amount-guard domain errors (scenario findings #2/#3/#4/#5/#6).
 *
 * Pure domain errors — no Nest, no Prisma, no framework imports. Each carries a
 * stable `code` so the global DomainExceptionFilter can map it to a clean 4xx
 * without importing the concrete class (mirrors execution-errors.ts).
 *
 * These guards run at the START of each proposal use-case — BEFORE pricing, the
 * KYC/tier gate, or any provider call — so an obviously-bad amount (zero, dust,
 * below the configured minimum, fee-dwarfing) surfaces as ordinary correctable
 * bad input (422) instead of:
 *   - an unmapped QuotePricingError → opaque 500 (finding #2),
 *   - a confusing "tier limit exceeded" 403 (finding #6), or
 *   - a post-PIN provider failure on the money path (finding #3).
 */

/** The kind of operation whose amount failed the floor/positivity guard. */
export type AmountGuardOperation = 'buy' | 'sell' | 'send' | 'swap';

/**
 * Thrown when a proposed amount is non-positive or below the configured minimum
 * (or, for sends, does not exceed the network fee). The `unit` is the fiat code
 * for buys (e.g. 'NGN') and the asset symbol for crypto-denominated operations
 * (e.g. 'USDT'). Amount/minimum are decimal strings — never floats — so the
 * caller can echo the exact configured floor back to the user.
 * Code: AMOUNT_TOO_SMALL → mapped to 422 by the global filter.
 */
export class AmountTooSmallError extends Error {
  readonly code = 'AMOUNT_TOO_SMALL' as const;

  constructor(
    readonly operation: AmountGuardOperation,
    readonly attempted: string,
    readonly minimum: string,
    readonly unit: string,
  ) {
    super(
      `${operation} amount ${attempted} ${unit} is below the minimum of ${minimum} ${unit}`,
    );
    this.name = 'AmountTooSmallError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a proposed transaction's fiat value EXCEEDS the admin-configured
 * per-(capability, asset, currency) maximum on the pricing config. This is a
 * product/market cap (distinct from the per-user KYC-tier limit) — enforced only
 * when a max is configured for that row (enforce-when-present). `unit` is the fiat
 * code; amount/maximum are decimal strings so the caller can echo the exact cap.
 * Code: AMOUNT_TOO_LARGE → mapped to 422 by the global filter.
 */
export class AmountTooLargeError extends Error {
  readonly code = 'AMOUNT_TOO_LARGE' as const;

  constructor(
    readonly operation: AmountGuardOperation,
    readonly attempted: string,
    readonly maximum: string,
    readonly unit: string,
  ) {
    super(
      `${operation} amount ${attempted} ${unit} exceeds the maximum of ${maximum} ${unit}`,
    );
    this.name = 'AmountTooLargeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by createSendProposal when the destination address is the user's own
 * provisioned custodial wallet address — there is no transfer to make, and the
 * masked confirmation card cannot show enough for the user to recognise their
 * own address. The message deliberately does NOT echo the address.
 * Code: SELF_SEND_BLOCKED → mapped to 422 by the global filter.
 */
export class SelfSendError extends Error {
  readonly code = 'SELF_SEND_BLOCKED' as const;

  constructor() {
    super(
      'This is your own wallet address — no transfer is needed. ' +
        'Choose a different recipient.',
    );
    this.name = 'SelfSendError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
