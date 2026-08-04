/**
 * Per-transaction profit derivation (go-readiness #5 — accurate profit tracking).
 *
 * Pure domain money-math: from a completed transaction's authoritative `Quote`
 * snapshot, derive the platform's realized FEE and SPREAD in fiat. This is the
 * safe, ledger-non-invasive path to *accurate* profit (see
 * docs/go-readiness-program.md §5) — the metrics layer aggregates these per tx.
 *
 * Exact BigInt arithmetic at scale-18 (fiat is 2-dp, crypto up to 18-dp, rates can
 * be large); floats cannot represent ledger amounts without drift. Framework-free —
 * the scale-18 codec it builds on imports nothing either.
 */

import {
  SCALE_18_FACTOR,
  fromScaled18,
  toScaled18,
} from '../../../core/common/decimal-scale';

/** The two priced, fiat-denominated capabilities that realize a fee + spread. */
export type TxProfitType = 'buy' | 'sell';

/**
 * The fields lifted from a completed transaction's `Quote` snapshot. Note the
 * `fiatAmount` convention differs by type (verified against proposal.service.ts):
 * BUY stores GROSS (fee-inclusive) fiat; SELL stores NET (post-fee) fiat.
 */
export interface TxProfitInput {
  type: TxProfitType;
  /** BUY: gross fiat the user paid. SELL: net fiat the user received (post-fee). */
  fiatAmount: string;
  /** Crypto delivered (buy) / sold (sell). */
  cryptoAmount: string;
  /** Raw pre-spread mid-market rate (fiat per 1 unit of the asset). */
  baseRate: string;
  /** Processing fee already charged, in fiat. */
  processingFeeAmount: string;
}

/** Realized platform revenue for one transaction, in fiat decimal strings. */
export interface TxProfit {
  fee: string;
  spread: string;
  /** Total realized profit = fee + spread (exact; computed once at scale-18). */
  profit: string;
}

/**
 * Derives the realized fee + spread (fiat) for one completed buy/sell.
 *
 *   BUY  — netFiat = fiatAmount − fee;  spread = netFiat − cryptoAmount×baseRate
 *   SELL — fiatBeforeFee = fiatAmount + fee;  spread = cryptoAmount×baseRate − fiatBeforeFee
 *
 * The spread is the difference between the fiat the platform kept and the
 * mid-market value of the crypto that changed hands. It can be marginally off the
 * nominal bps due to the quote's flooring of `cryptoAmount` — this returns the
 * EXACT realized value, not the nominal.
 */
export function computeTxProfit(input: TxProfitInput): TxProfit {
  const fee = toScaled18(input.processingFeeAmount);
  const fiat = toScaled18(input.fiatAmount);
  const crypto = toScaled18(input.cryptoAmount);
  const base = toScaled18(input.baseRate);

  // Mid-market fiat value of the crypto: (crypto × base) with one scale removed.
  const midValue = (crypto * base) / SCALE_18_FACTOR;

  const spread =
    input.type === 'buy'
      ? fiat - fee - midValue // netFiat − mid
      : midValue - (fiat + fee); // mid − fiatBeforeFee

  return {
    fee: fromScaled18(fee),
    spread: fromScaled18(spread),
    profit: fromScaled18(fee + spread),
  };
}
