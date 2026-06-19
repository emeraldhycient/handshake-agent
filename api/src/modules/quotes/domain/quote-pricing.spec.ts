import { computeBuyQuote, QuotePricingError } from './quote-pricing';

describe('computeBuyQuote', () => {
  it('applies the processing fee to fiat and the spread to the rate', () => {
    const result = computeBuyQuote({
      fiatAmount: 100000, // NGN
      baseRate: 1600, // NGN per 1 USDT
      spreadBps: 150, // 1.5%
      processingFeeBps: 100, // 1%
      cryptoDecimals: 6,
    });

    expect(result.processingFee).toBe(1000); // 1% of 100,000
    expect(result.netFiat).toBe(99000);
    expect(result.effectiveRate).toBe(1624); // 1600 * 1.015
    expect(result.cryptoAmount).toBe('60.960591'); // floor(99000 / 1624, 6)
  });

  it('returns the exact division when there is no spread or fee', () => {
    const result = computeBuyQuote({
      fiatAmount: 100000,
      baseRate: 2000,
      spreadBps: 0,
      processingFeeBps: 0,
      cryptoDecimals: 2,
    });

    expect(result.processingFee).toBe(0);
    expect(result.cryptoAmount).toBe('50.00');
  });

  it('floors the crypto amount so the user is never over-credited', () => {
    const result = computeBuyQuote({
      fiatAmount: 100,
      baseRate: 3,
      spreadBps: 0,
      processingFeeBps: 0,
      cryptoDecimals: 2,
    });

    expect(result.cryptoAmount).toBe('33.33'); // floor(33.333…, 2)
  });

  it('rejects a non-positive fiat amount', () => {
    expect(() =>
      computeBuyQuote({
        fiatAmount: 0,
        baseRate: 1600,
        spreadBps: 150,
        processingFeeBps: 100,
        cryptoDecimals: 6,
      }),
    ).toThrow(QuotePricingError);
  });

  it('rejects a non-positive base rate', () => {
    expect(() =>
      computeBuyQuote({
        fiatAmount: 100000,
        baseRate: 0,
        spreadBps: 150,
        processingFeeBps: 100,
        cryptoDecimals: 6,
      }),
    ).toThrow(QuotePricingError);
  });
});
