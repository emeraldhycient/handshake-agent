import type { Clock } from '../../../core/common/clock';
import type { IRateProvider, RateQuote } from './ports/rate-provider.port';
import { QuotesService } from './quotes.service';
import { QuoteSellOutputSchema } from '@handshake-agent/contracts';

const RATE: RateQuote = {
  baseRate: 1600,
  spreadBps: 150,
  processingFeeBps: 100,
  expiresInSec: 30,
  cryptoDecimals: 6,
};

const fixedClock: Clock = {
  now: () => new Date('2026-06-18T00:00:00.000Z'),
};

describe('QuotesService.quoteBuy', () => {
  it('builds an itemized buy quote from the rate provider and the pricing domain', async () => {
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
    // fxRate is the effective (spread-inclusive) rate used for conversion.
    expect(quote.fxRate).toBe('1624');
    expect(quote.spreadBps).toBe(150);
    expect(quote.processingFeeBps).toBe(100);
    expect(quote.expiresInSec).toBe(30);
    expect(quote.quotedAt).toBe('2026-06-18T00:00:00.000Z');
  });
});

describe('QuotesService.quoteSell', () => {
  it('builds an itemized sell quote from the rate provider and the pricing domain', async () => {
    // User sells 100 USDT; baseRate 1600, spreadBps 150, processingFeeBps 100
    // effectiveRate = round(1600 * (1 - 0.015), 6) = round(1576, 6) = 1576
    // fiatBeforeFee = 100 * 1576 = 157600
    // processingFeeAmount = round(157600 * 0.01, 2) = 1576
    // netFiat = floor(157600 - 1576, 2) = 156024
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
    expect(quote.netFiatAmount).toBe('156024');
    // baseRate is the raw pre-spread market rate from the rate provider.
    expect(quote.baseRate).toBe('1600');
    // fxRate is the effective (spread-reduced) rate the user receives.
    expect(quote.fxRate).toBe('1576');
    expect(quote.spreadBps).toBe(150);
    expect(quote.processingFeeBps).toBe(100);
    expect(quote.processingFeeAmount).toBe('1576');
    expect(quote.expiresInSec).toBe(30);
    expect(quote.quotedAt).toBe('2026-06-18T00:00:00.000Z');
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
