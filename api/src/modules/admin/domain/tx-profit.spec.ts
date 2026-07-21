/**
 * Per-transaction profit derivation (go-readiness #5 — accurate profit tracking).
 *
 * Pure money-math: from a completed transaction's authoritative Quote snapshot,
 * derive the platform's realized FEE and SPREAD in fiat. Exact BigInt (scale-18)
 * arithmetic — never floats. See docs/go-readiness-program.md §5 for the linkage
 * and the buy/sell derivation (verified against quote-pricing.ts).
 *
 * TDD: written before `computeTxProfit` exists (red → green).
 */
import { computeTxProfit } from './tx-profit';

describe('computeTxProfit', () => {
  describe('buy', () => {
    // baseRate 1000; buy effective 1015 (1.5% up). fiatAmount is GROSS (incl. fee).
    it('spread = netFiat − cryptoAmount×baseRate; fee = processingFeeAmount (zero fee)', () => {
      // netFiat 1015 buys 1 unit at effective 1015; mid value 1×1000 = 1000 → spread 15.
      expect(
        computeTxProfit({
          type: 'buy',
          fiatAmount: '1015',
          cryptoAmount: '1',
          baseRate: '1000',
          processingFeeAmount: '0',
        }),
      ).toEqual({ fee: '0', spread: '15', profit: '15' });
    });

    it('nets the fee out of gross fiat before the spread (fee > 0)', () => {
      // gross 1115 − fee 100 = netFiat 1015 → spread 15; fee 100.
      expect(
        computeTxProfit({
          type: 'buy',
          fiatAmount: '1115',
          cryptoAmount: '1',
          baseRate: '1000',
          processingFeeAmount: '100',
        }),
      ).toEqual({ fee: '100', spread: '15', profit: '115' });
    });

    it('holds decimal precision (6-dp crypto, 2-dp fiat) exactly', () => {
      // netFiat 9900, crypto 6.096059, base 1600 → mid 9753.6944 → spread 146.3056.
      expect(
        computeTxProfit({
          type: 'buy',
          fiatAmount: '10000',
          cryptoAmount: '6.096059',
          baseRate: '1600',
          processingFeeAmount: '100',
        }),
      ).toEqual({ fee: '100', spread: '146.3056', profit: '246.3056' });
    });
  });

  describe('sell', () => {
    // baseRate 1000; sell effective 985 (1.5% down). fiatAmount is NET (post-fee).
    it('spread = cryptoAmount×baseRate − fiatBeforeFee; fee = processingFeeAmount', () => {
      // fiatBeforeFee = net 935 + fee 50 = 985; mid 1×1000 = 1000 → spread 15; fee 50.
      expect(
        computeTxProfit({
          type: 'sell',
          fiatAmount: '935',
          cryptoAmount: '1',
          baseRate: '1000',
          processingFeeAmount: '50',
        }),
      ).toEqual({ fee: '50', spread: '15', profit: '65' });
    });
  });

  // A quote can realize a NEGATIVE spread — the base rate moved against us between
  // quote and settle, or `cryptoAmount` flooring overshot. The sign must survive
  // both the derivation and the scale-18 round trip, because the metrics repo SUMS
  // these per currency: a spread that came back unsigned would silently inflate
  // reported platform profit. Nothing else pinned the negative branch.
  it('returns a NEGATIVE spread (and profit) for a loss-making buy', () => {
    // netFiat 990 buys 1 unit whose mid value is 1000 → spread −10; fee 10 → profit −0.
    expect(
      computeTxProfit({
        type: 'buy',
        fiatAmount: '1000',
        cryptoAmount: '1',
        baseRate: '1000',
        processingFeeAmount: '10',
      }),
    ).toEqual({ fee: '10', spread: '-10', profit: '0' });
  });

  it('keeps a negative spread exact at fractional scale', () => {
    // netFiat 999.5 vs mid 1000.25 → spread −0.75; fee 0.5 → profit −0.25.
    expect(
      computeTxProfit({
        type: 'buy',
        fiatAmount: '1000',
        cryptoAmount: '1.00025',
        baseRate: '1000',
        processingFeeAmount: '0.5',
      }),
    ).toEqual({ fee: '0.5', spread: '-0.75', profit: '-0.25' });
  });

  it('is exact for large ledger-scale amounts (no float drift)', () => {
    // BTC: base 100,000,000 NGN; buy 0.001 BTC at effective 101,500,000.
    // netFiat 101500 buys 0.001 at effective → mid 0.001×100000000 = 100000 → spread 1500.
    expect(
      computeTxProfit({
        type: 'buy',
        fiatAmount: '101500',
        cryptoAmount: '0.001',
        baseRate: '100000000',
        processingFeeAmount: '0',
      }),
    ).toEqual({ fee: '0', spread: '1500', profit: '1500' });
  });
});
