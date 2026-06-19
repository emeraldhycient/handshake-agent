import type { Clock } from '../../../core/common/clock';
import type { IRateProvider, RateQuote } from './ports/rate-provider.port';
import { QuotesService } from './quotes.service';

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
    expect(quote.fxRate).toBe('1624');
    expect(quote.spreadBps).toBe(150);
    expect(quote.processingFeeBps).toBe(100);
    expect(quote.expiresInSec).toBe(30);
    expect(quote.quotedAt).toBe('2026-06-18T00:00:00.000Z');
  });
});
