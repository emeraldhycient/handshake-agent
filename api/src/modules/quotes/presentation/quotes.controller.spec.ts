import type { QuoteBuyOutput } from '@handshake-agent/contracts';

import type { QuotesService } from '../application/quotes.service';
import { QuotesController } from './quotes.controller';
import type { QuoteBuyDto } from './dto/quote-buy.dto';

const OUTPUT: QuoteBuyOutput = {
  asset: 'USDT',
  fiatAmount: '100000',
  fiatCurrency: 'NGN',
  cryptoAmount: '60.960591',
  baseRate: '1600',
  fxRate: '1624',
  spreadBps: 150,
  processingFeeBps: 100,
  quotedAt: '2026-06-18T00:00:00.000Z',
  expiresInSec: 30,
};

describe('QuotesController', () => {
  it('delegates a buy quote to the service and returns its result', async () => {
    const service = { quoteBuy: jest.fn().mockResolvedValue(OUTPUT) };
    const controller = new QuotesController(
      service as unknown as QuotesService,
    );
    const dto = {
      asset: 'USDT',
      fiatAmount: '100000',
      fiatCurrency: 'NGN',
    } as QuoteBuyDto;

    const result = await controller.buy(dto);

    expect(service.quoteBuy).toHaveBeenCalledWith(dto);
    expect(result).toBe(OUTPUT);
  });
});
