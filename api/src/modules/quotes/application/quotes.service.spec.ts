import type { Clock } from '../../../core/common/clock';
import type { IRateProvider, RateQuote } from './ports/rate-provider.port';
import { QuotesService } from './quotes.service';
import { QuoteSellOutputSchema } from '@handshake-agent/contracts';

const RATE: RateQuote = {
  baseRate: 1600,
  buySpreadBps: 150,
  sellSpreadBps: 200,
  processingFeeBps: 100,
  expiresInSec: 30,
  cryptoDecimals: 6,
};

const fixedClock: Clock = {
  now: () => new Date('2026-06-18T00:00:00.000Z'),
};

describe('QuotesService.quoteBuy', () => {
  it('builds an itemized buy quote using the buy spread from the rate provider', async () => {
    const rateProvider: IRateProvider = {
      getRate: jest.fn().mockResolvedValue(RATE),
    };
    const service = new QuotesService(rateProvider, fixedClock);

    const quote = await service.quoteBuy({
      asset: 'USDT',
      fiatAmount: '100000',
      fiatCurrency: 'NGN',
    });

    expect(rateProvider.getRate).toHaveBeenCalledWith('USDT', 'NGN');
    expect(quote.asset).toBe('USDT');
    expect(quote.fiatAmount).toBe('100000');
    expect(quote.fiatCurrency).toBe('NGN');
    expect(quote.cryptoAmount).toBe('60.960591');
    // baseRate is the raw pre-spread market rate from the rate provider.
    expect(quote.baseRate).toBe('1600');
    // fxRate is the effective (buy-spread-inclusive) rate used for conversion.
    expect(quote.fxRate).toBe('1624'); // 1600 * (1 + 0.015)
    // spreadBps reports the APPLIED spread — the buy spread for a buy quote.
    expect(quote.spreadBps).toBe(150);
    expect(quote.processingFeeBps).toBe(100);
    expect(quote.expiresInSec).toBe(30);
    expect(quote.quotedAt).toBe('2026-06-18T00:00:00.000Z');
  });
});

describe('QuotesService.quoteSell', () => {
  it('builds an itemized sell quote using the sell spread (not the buy spread)', async () => {
    // User sells 100 USDT; baseRate 1600, sellSpreadBps 200, processingFeeBps 100
    // effectiveRate = round(1600 * (1 - 0.02), 6) = round(1568, 6) = 1568
    // fiatBeforeFee = 100 * 1568 = 156800
    // processingFeeAmount = round(156800 * 0.01, 2) = 1568
    // netFiat = floor(156800 - 1568, 2) = 155232
    const rateProvider: IRateProvider = {
      getRate: jest.fn().mockResolvedValue(RATE),
    };
    const service = new QuotesService(rateProvider, fixedClock);

    const quote = await service.quoteSell({
      asset: 'USDT',
      cryptoAmount: '100',
      fiatCurrency: 'NGN',
    });

    expect(rateProvider.getRate).toHaveBeenCalledWith('USDT', 'NGN');
    expect(quote.asset).toBe('USDT');
    expect(quote.cryptoAmount).toBe('100');
    expect(quote.fiatCurrency).toBe('NGN');
    expect(quote.netFiatAmount).toBe('155232');
    // baseRate is the raw pre-spread market rate from the rate provider.
    expect(quote.baseRate).toBe('1600');
    // fxRate is the effective (sell-spread-reduced) rate the user receives.
    expect(quote.fxRate).toBe('1568'); // 1600 * (1 - 0.02)
    // spreadBps reports the APPLIED spread — the sell spread for a sell quote.
    expect(quote.spreadBps).toBe(200);
    expect(quote.processingFeeBps).toBe(100);
    expect(quote.processingFeeAmount).toBe('1568');
    expect(quote.expiresInSec).toBe(30);
    expect(quote.quotedAt).toBe('2026-06-18T00:00:00.000Z');
  });

  it('sell quote reports the sell spread (200 bps), not the buy spread (150 bps)', async () => {
    const rateProvider: IRateProvider = {
      getRate: jest.fn().mockResolvedValue(RATE),
    };
    const service = new QuotesService(rateProvider, fixedClock);

    const quote = await service.quoteSell({
      asset: 'USDT',
      cryptoAmount: '100',
      fiatCurrency: 'NGN',
    });

    // Proves independence: sell quote uses sellSpreadBps (200), not buySpreadBps (150).
    expect(quote.spreadBps).toBe(200);
    expect(quote.spreadBps).not.toBe(RATE.buySpreadBps);
  });

  it('output parses against QuoteSellOutputSchema', async () => {
    const rateProvider: IRateProvider = {
      getRate: jest.fn().mockResolvedValue(RATE),
    };
    const service = new QuotesService(rateProvider, fixedClock);

    const quote = await service.quoteSell({
      asset: 'USDT',
      cryptoAmount: '50',
      fiatCurrency: 'NGN',
    });

    expect(() => QuoteSellOutputSchema.parse(quote)).not.toThrow();
  });
});
