import { Inject, Injectable } from '@nestjs/common';
import type { QuoteBuyInput, QuoteBuyOutput } from '@handshake-agent/contracts';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { computeBuyQuote } from '../domain/quote-pricing';
import { RATE_PROVIDER, type IRateProvider } from './ports/rate-provider.port';

/**
 * Buy-quote use-case. Pure orchestration: pull a rate through the port, run the
 * pricing domain, stamp the time, and assemble the contract DTO. No DB, no
 * framework leakage, no side effects — quoting never moves money.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(RATE_PROVIDER) private readonly rateProvider: IRateProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async quoteBuy(input: QuoteBuyInput): Promise<QuoteBuyOutput> {
    const rate = await this.rateProvider.getRate(
      input.asset,
      input.fiatCurrency,
    );

    const breakdown = computeBuyQuote({
      // Single explicit coercion at the boundary; the value is already
      // validated by the contract schema before it reaches the service.
      fiatAmount: Number(input.fiatAmount),
      baseRate: rate.baseRate,
      spreadBps: rate.spreadBps,
      processingFeeBps: rate.processingFeeBps,
      cryptoDecimals: rate.cryptoDecimals,
    });

    return {
      asset: input.asset,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
      cryptoAmount: breakdown.cryptoAmount,
      // Raw pre-spread market rate — stored in the Quote row for treasury/audit.
      baseRate: String(rate.baseRate),
      // Effective (spread-inclusive) rate — used for conversion and shown to user.
      fxRate: String(breakdown.effectiveRate),
      spreadBps: rate.spreadBps,
      processingFeeBps: rate.processingFeeBps,
      quotedAt: this.clock.now().toISOString(),
      expiresInSec: rate.expiresInSec,
    };
  }
}
