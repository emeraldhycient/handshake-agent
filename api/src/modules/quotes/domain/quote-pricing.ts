/**
 * Pure buy/sell-quote pricing. No framework, no IO — this is the money-math the
 * deterministic execution engine and the quote endpoint both rely on.
 *
 * Buy and sell price off the SAME baseRate but with INDEPENDENT spreads:
 *   - BUY effective rate  = baseRate * (1 + buySpreadBps/10000)  — user pays more per crypto
 *   - SELL effective rate = baseRate * (1 − sellSpreadBps/10000) — user receives less per crypto
 * The margin ≈ buySpreadBps + sellSpreadBps (the bid-ask gap).
 *
 * NOTE: amounts use `number` for clarity in this scaffold. Production should
 * carry money as a decimal type (e.g. decimal.js / bigint minor units) to avoid
 * float drift; the tests pin the rounding behaviour either way.
 */

export interface BuyQuoteParams {
  /** Fiat the user spends, in major units (e.g. NGN). */
  fiatAmount: number;
  /** Base market rate: fiat per 1 unit of the asset. */
  baseRate: number;
  /** Platform buy spread, in basis points, marked up onto the rate (user gets less crypto). */
  buySpreadBps: number;
  /** Processing fee, in basis points, taken off the fiat amount. */
  processingFeeBps: number;
  /** Decimal places the asset is quoted to (e.g. 6 for USDT). */
  cryptoDecimals: number;
}

export interface BuyQuoteBreakdown {
  processingFee: number;
  netFiat: number;
  effectiveRate: number;
  cryptoAmount: string;
}

/**
 * Pricing-domain validation error (non-positive amount, non-positive/zeroed-out
 * rate). Carries a stable `code` so the global DomainExceptionFilter maps it to a
 * clean 422 instead of falling through to an opaque 500 (finding #2). The
 * proposal-boundary amount guard normally rejects bad input first, so this is
 * defense-in-depth for any non-proposal caller (e.g. the /quote endpoint).
 */
export class QuotePricingError extends Error {
  readonly code = 'QUOTE_INVALID_AMOUNT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'QuotePricingError';
    // Restore prototype chain (needed when target < ES2022 transpiles classes).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const floorTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
};

export interface SellQuoteParams {
  /** Crypto the user wants to sell, in major units (e.g. USDT). */
  cryptoAmount: number;
  /** Base market rate: fiat per 1 unit of the asset. */
  baseRate: number;
  /** Platform sell spread, in basis points, applied AGAINST the user (reduces their rate). */
  sellSpreadBps: number;
  /** Processing fee, in basis points, taken off the gross fiat amount. */
  processingFeeBps: number;
}

export interface SellQuoteBreakdown {
  /** Effective (post-spread) rate the user receives per unit of crypto. */
  effectiveRate: number;
  /** Fiat amount before the processing fee is deducted. */
  fiatBeforeFee: number;
  /** Processing fee amount in fiat. */
  processingFeeAmount: number;
  /** Net fiat the user receives after spread + fee (floored to 2 d.p.). */
  netFiat: number;
}

export function computeSellQuote(params: SellQuoteParams): SellQuoteBreakdown {
  const { cryptoAmount, baseRate, sellSpreadBps, processingFeeBps } = params;

  if (cryptoAmount <= 0) {
    throw new QuotePricingError('cryptoAmount must be positive');
  }
  if (baseRate <= 0) {
    throw new QuotePricingError('baseRate must be positive');
  }

  // Sell spread works against the user: they receive less per unit.
  const effectiveRate = roundTo(baseRate * (1 - sellSpreadBps / 10000), 6);
  // Fail closed if the spread drives the effective rate to <= 0 (sellSpreadBps
  // >= 100%, i.e. >= 10000 bps). A 0/negative rate would otherwise silently
  // produce a 0/negative payout instead of surfacing the misconfiguration (§3.1).
  if (effectiveRate <= 0) {
    throw new QuotePricingError(
      `effectiveRate must be positive (sellSpreadBps=${sellSpreadBps} drives the rate to ${effectiveRate}); ` +
        'a spread >= 100% is a pricing misconfiguration',
    );
  }
  const fiatBeforeFee = roundTo(cryptoAmount * effectiveRate, 2);
  const processingFeeAmount = roundTo(
    (fiatBeforeFee * processingFeeBps) / 10000,
    2,
  );
  // Floor (never round up) so the platform never pays out more than computed.
  const netFiat = floorTo(fiatBeforeFee - processingFeeAmount, 2);

  return { effectiveRate, fiatBeforeFee, processingFeeAmount, netFiat };
}

/**
 * Values a crypto holding in fiat at the realizable SELL rate.
 * effectiveRate = baseRate × (1 − sellSpreadBps/10000); fee-exclusive.
 * Floored to 2 d.p. so a displayed valuation never overstates realizable value.
 */
export function valueAtSellRate(
  amount: string,
  baseRate: number,
  sellSpreadBps: number,
): string {
  const qty = Number(amount);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new QuotePricingError('amount must be a non-negative number');
  }
  if (baseRate <= 0) {
    throw new QuotePricingError('baseRate must be positive');
  }
  const effectiveRate = roundTo(baseRate * (1 - sellSpreadBps / 10000), 6);
  return floorTo(qty * effectiveRate, 2).toFixed(2);
}

export function computeBuyQuote(params: BuyQuoteParams): BuyQuoteBreakdown {
  const {
    fiatAmount,
    baseRate,
    buySpreadBps,
    processingFeeBps,
    cryptoDecimals,
  } = params;

  if (fiatAmount <= 0) {
    throw new QuotePricingError('fiatAmount must be positive');
  }
  if (baseRate <= 0) {
    throw new QuotePricingError('baseRate must be positive');
  }

  const processingFee = roundTo((fiatAmount * processingFeeBps) / 10000, 2);
  const netFiat = fiatAmount - processingFee;
  // Quote the rate to a fixed precision so the result is deterministic and free
  // of float noise (1600 * 1.015 would otherwise be 1623.9999…).
  const effectiveRate = roundTo(baseRate * (1 + buySpreadBps / 10000), 6);
  // Fail closed if a misconfigured (negative) spread drives the effective rate
  // to <= 0. Dividing netFiat by a 0/negative rate would otherwise produce a
  // 0/negative or non-finite crypto amount silently rather than surfacing the
  // misconfiguration (§3.1).
  if (effectiveRate <= 0) {
    throw new QuotePricingError(
      `effectiveRate must be positive (buySpreadBps=${buySpreadBps} drives the rate to ${effectiveRate}); ` +
        'this is a pricing misconfiguration',
    );
  }
  // Floor (never round up) so the platform never credits more crypto than paid for.
  const cryptoAmount = floorTo(netFiat / effectiveRate, cryptoDecimals).toFixed(
    cryptoDecimals,
  );

  return { processingFee, netFiat, effectiveRate, cryptoAmount };
}
