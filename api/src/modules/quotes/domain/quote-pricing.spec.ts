import {
  buyEffectiveRate,
  computeBuyQuote,
  computeSellQuote,
  QuotePricingError,
  sellEffectiveRate,
  valueAtSellRate,
} from './quote-pricing';

describe('QuotePricingError', () => {
  // Finding #2: a non-positive/below-minimum buy was throwing an UNMAPPED
  // QuotePricingError (no `code`), so the global filter fell through to an opaque
  // 500. A stable code lets the filter map it to a clean 422 even if the
  // proposal-boundary guard is bypassed (defense-in-depth).
  it('carries the stable QUOTE_INVALID_AMOUNT code', () => {
    const err = new QuotePricingError('fiatAmount must be positive');
    expect(err.code).toBe('QUOTE_INVALID_AMOUNT');
  });

  it('is an Error with a name and survives instanceof', () => {
    const err = new QuotePricingError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QuotePricingError');
    expect(err instanceof QuotePricingError).toBe(true);
  });

  it('errors thrown from computeBuyQuote/computeSellQuote carry the code', () => {
    try {
      computeBuyQuote({
        fiatAmount: 0,
        baseRate: 1600,
        buySpreadBps: 150,
        processingFeeBps: 100,
        cryptoDecimals: 6,
      });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as QuotePricingError).code).toBe('QUOTE_INVALID_AMOUNT');
    }
  });
});

describe('computeBuyQuote', () => {
  it('applies the processing fee to fiat and the buySpread to the rate', () => {
    // buySpreadBps=150 → same result as the old spreadBps=150 buy test (no buy regression)
    const result = computeBuyQuote({
      fiatAmount: 100000, // NGN
      baseRate: 1600, // NGN per 1 USDT
      buySpreadBps: 150, // 1.5%
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
      buySpreadBps: 0,
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
      buySpreadBps: 0,
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
        buySpreadBps: 150,
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
        buySpreadBps: 150,
        processingFeeBps: 100,
        cryptoDecimals: 6,
      }),
    ).toThrow(QuotePricingError);
  });

  // ── Fail-closed effective-rate guard (finding #27) ───────────────────────
  // A misconfigured negative spread can push the effective buy rate to <= 0,
  // which would produce a 0/negative crypto amount via division. Fail closed.
  it('rejects a misconfigured spread that drives the effective buy rate <= 0', () => {
    expect(() =>
      computeBuyQuote({
        fiatAmount: 100000,
        baseRate: 1600,
        buySpreadBps: -10000, // 1 + (-10000/10000) = 0 → effective rate 0
        processingFeeBps: 100,
        cryptoDecimals: 6,
      }),
    ).toThrow(QuotePricingError);

    expect(() =>
      computeBuyQuote({
        fiatAmount: 100000,
        baseRate: 1600,
        buySpreadBps: -20000, // effective rate negative
        processingFeeBps: 100,
        cryptoDecimals: 6,
      }),
    ).toThrow(QuotePricingError);
  });
});

describe('computeSellQuote', () => {
  it('applies sellSpread against the user (reducing effective rate) and subtracts processing fee', () => {
    // User sells 100 USDT at baseRate 1600 NGN/USDT
    // sellSpreadBps 150 (1.5%) → effectiveRate = 1600 * (1 - 0.015) = 1600 * 0.985 = 1576
    // fiatBeforeFee = 100 * 1576 = 157600
    // processingFeeAmount = 157600 * 0.01 = 1576
    // netFiat = 157600 - 1576 = 156024
    const result = computeSellQuote({
      cryptoAmount: 100,
      baseRate: 1600,
      sellSpreadBps: 150,
      processingFeeBps: 100,
    });

    expect(result.effectiveRate).toBe(1576); // 1600 * (1 - 0.015)
    expect(result.fiatBeforeFee).toBe(157600);
    expect(result.processingFeeAmount).toBe(1576);
    expect(result.netFiat).toBe(156024);
  });

  it('returns the exact conversion when there is no spread or fee', () => {
    const result = computeSellQuote({
      cryptoAmount: 10,
      baseRate: 1600,
      sellSpreadBps: 0,
      processingFeeBps: 0,
    });

    expect(result.effectiveRate).toBe(1600);
    expect(result.fiatBeforeFee).toBe(16000);
    expect(result.processingFeeAmount).toBe(0);
    expect(result.netFiat).toBe(16000);
  });

  it('floors the netFiat to 2 decimal places so the platform never overpays', () => {
    // cryptoAmount=1, baseRate=1600, sellSpreadBps=333 (3.33%)
    // effectiveRate = round(1600 * (1 - 0.0333), 6) = round(1546.72, 6) = 1546.72
    // fiatBeforeFee = 1 * 1546.72 = 1546.72
    // processingFeeAmount = round(1546.72 * 0.01, 2) = round(15.4672, 2) = 15.47
    // fiatBeforeFee - processingFeeAmount = 1546.72 - 15.47 = 1531.25 → floor to 2dp → 1531.25
    const result = computeSellQuote({
      cryptoAmount: 1,
      baseRate: 1600,
      sellSpreadBps: 333,
      processingFeeBps: 100,
    });

    expect(result.netFiat).toBe(1531.25);
    expect(Number.isFinite(result.netFiat)).toBe(true);
  });

  it('rejects a zero or negative crypto amount', () => {
    expect(() =>
      computeSellQuote({
        cryptoAmount: 0,
        baseRate: 1600,
        sellSpreadBps: 150,
        processingFeeBps: 100,
      }),
    ).toThrow(QuotePricingError);

    expect(() =>
      computeSellQuote({
        cryptoAmount: -1,
        baseRate: 1600,
        sellSpreadBps: 150,
        processingFeeBps: 100,
      }),
    ).toThrow(QuotePricingError);
  });

  it('rejects a non-positive base rate', () => {
    expect(() =>
      computeSellQuote({
        cryptoAmount: 100,
        baseRate: 0,
        sellSpreadBps: 150,
        processingFeeBps: 100,
      }),
    ).toThrow(QuotePricingError);
  });

  // ── Fail-closed effective-rate guard (finding #27) ───────────────────────
  // A spread >= 100% (sellSpreadBps >= 10000) drives the effective sell rate to
  // <= 0. A 0/negative rate would silently produce a 0/negative payout instead
  // of throwing — fail closed so the misconfiguration surfaces (§3.1).
  it('rejects a sell spread of exactly 100% (effective rate 0)', () => {
    expect(() =>
      computeSellQuote({
        cryptoAmount: 100,
        baseRate: 1600,
        sellSpreadBps: 10000, // 1 - 1.0 = 0 → effective rate 0
        processingFeeBps: 100,
      }),
    ).toThrow(QuotePricingError);
  });

  it('rejects a sell spread greater than 100% (negative effective rate)', () => {
    expect(() =>
      computeSellQuote({
        cryptoAmount: 100,
        baseRate: 1600,
        sellSpreadBps: 12000, // 1 - 1.2 = -0.2 → negative effective rate
        processingFeeBps: 100,
      }),
    ).toThrow(QuotePricingError);
  });

  it('sellSpreadBps=200 yields less NGN than sellSpreadBps=150 (proves independence)', () => {
    // Same baseRate and cryptoAmount, but higher sellSpread → user gets less
    const with150 = computeSellQuote({
      cryptoAmount: 100,
      baseRate: 1600,
      sellSpreadBps: 150,
      processingFeeBps: 100,
    });
    const with200 = computeSellQuote({
      cryptoAmount: 100,
      baseRate: 1600,
      sellSpreadBps: 200,
      processingFeeBps: 100,
    });

    expect(with200.netFiat).toBeLessThan(with150.netFiat);
    expect(with200.effectiveRate).toBeLessThan(with150.effectiveRate);
  });
});

describe('valueAtSellRate', () => {
  it('values crypto at the sell-spread-reduced rate, floored to 2dp', () => {
    // baseRate 1650, sellSpread 200bps → effective 1617; 29.97 × 1617 = 48461.49
    expect(valueAtSellRate('29.97', 1650, 200)).toBe('48461.49');
  });
  it('returns 0.00 for a zero balance', () => {
    expect(valueAtSellRate('0', 1650, 200)).toBe('0.00');
  });
  it('throws on a non-positive base rate', () => {
    expect(() => valueAtSellRate('1', 0, 200)).toThrow();
  });
});

describe('buy rate > sell rate for the same baseRate (positive margin)', () => {
  it('buy effective rate (NGN/USDT) is greater than sell effective rate at same baseRate', () => {
    // The platform marks up for buy and marks down for sell — the spread between
    // them is the platform's margin.
    const { effectiveRate: buyRate } = computeBuyQuote({
      fiatAmount: 100000,
      baseRate: 1600,
      buySpreadBps: 150,
      processingFeeBps: 100,
      cryptoDecimals: 6,
    });
    const { effectiveRate: sellRate } = computeSellQuote({
      cryptoAmount: 100,
      baseRate: 1600,
      sellSpreadBps: 200,
      processingFeeBps: 100,
    });

    // buyRate > sellRate: user pays more per USDT than they receive per USDT → platform margin > 0
    expect(buyRate).toBeGreaterThan(sellRate);
  });
});

// ---------------------------------------------------------------------------
// buyEffectiveRate / sellEffectiveRate — the shared spread-fold helpers (Wave K).
// These MUST be the exact numbers computeBuyQuote/computeSellQuote embed, so the
// rate-discovery surface (RatesService) displays what the engine transacts at.
// ---------------------------------------------------------------------------

describe('buyEffectiveRate', () => {
  it('marks the base rate UP by the buy spread (6 d.p.)', () => {
    expect(buyEffectiveRate(1600, 150)).toBe(1624); // 1600 * (1 + 0.015)
  });

  it('equals the effectiveRate computeBuyQuote embeds for the same inputs', () => {
    const { effectiveRate } = computeBuyQuote({
      fiatAmount: 100000,
      baseRate: 1600,
      buySpreadBps: 150,
      processingFeeBps: 100,
      cryptoDecimals: 6,
    });
    expect(buyEffectiveRate(1600, 150)).toBe(effectiveRate);
  });

  it('fails closed when a misconfigured spread drives the rate <= 0', () => {
    expect(() => buyEffectiveRate(1600, -10000)).toThrow(QuotePricingError);
  });
});

describe('sellEffectiveRate', () => {
  it('marks the base rate DOWN by the sell spread (6 d.p.)', () => {
    expect(sellEffectiveRate(1600, 200)).toBe(1568); // 1600 * (1 - 0.02)
  });

  it('equals the effectiveRate computeSellQuote embeds for the same inputs', () => {
    const { effectiveRate } = computeSellQuote({
      cryptoAmount: 100,
      baseRate: 1600,
      sellSpreadBps: 200,
      processingFeeBps: 100,
    });
    expect(sellEffectiveRate(1600, 200)).toBe(effectiveRate);
  });

  it('fails closed when the sell spread drives the rate to <= 0 (>= 100%)', () => {
    expect(() => sellEffectiveRate(1600, 10000)).toThrow(QuotePricingError);
  });
});
