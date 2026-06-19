/**
 * Pure buy-quote pricing. No framework, no IO — this is the money-math the
 * deterministic execution engine and the quote endpoint both rely on.
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
  /** Platform spread, in basis points, marked up onto the rate. */
  spreadBps: number;
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

export class QuotePricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotePricingError';
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

export function computeBuyQuote(params: BuyQuoteParams): BuyQuoteBreakdown {
  const { fiatAmount, baseRate, spreadBps, processingFeeBps, cryptoDecimals } =
    params;

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
  const effectiveRate = roundTo(baseRate * (1 + spreadBps / 10000), 6);
  // Floor (never round up) so the platform never credits more crypto than paid for.
  const cryptoAmount = floorTo(netFiat / effectiveRate, cryptoDecimals).toFixed(
    cryptoDecimals,
  );

  return { processingFee, netFiat, effectiveRate, cryptoAmount };
}
