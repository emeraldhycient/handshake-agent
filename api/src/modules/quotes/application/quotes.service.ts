import { Inject, Injectable } from '@nestjs/common';
import type {
  QuoteBuyInput,
  QuoteBuyOutput,
  QuoteSellInput,
  QuoteSellOutput,
} from '@handshake-agent/contracts';

import { CLOCK, type Clock } from '../../../core/common/clock';
import { computeBuyQuote, computeSellQuote } from '../domain/quote-pricing';
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
      buySpreadBps: rate.buySpreadBps,
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
      // Reports the APPLIED (direction-specific) spread — the buy spread for buy quotes.
      spreadBps: rate.buySpreadBps,
      processingFeeBps: rate.processingFeeBps,
      quotedAt: this.clock.now().toISOString(),
      expiresInSec: rate.expiresInSec,
    };
  }

  /**
   * Sell-quote use-case. Given a crypto amount the user wants to sell, compute
   * the NGN they receive after spread + processing fee. Spread works AGAINST the
   * user in a sell direction (reduces the effective rate). No side effects — quoting
   * never moves money.
   */
  async quoteSell(input: QuoteSellInput): Promise<QuoteSellOutput> {
    const rate = await this.rateProvider.getRate(
      input.asset,
      input.fiatCurrency,
    );

    const breakdown = computeSellQuote({
      // Single explicit coercion at the boundary; the value is already
      // validated by the contract schema before it reaches the service.
      cryptoAmount: Number(input.cryptoAmount),
      baseRate: rate.baseRate,
      sellSpreadBps: rate.sellSpreadBps,
      processingFeeBps: rate.processingFeeBps,
    });

    return {
      asset: input.asset,
      cryptoAmount: input.cryptoAmount,
      fiatCurrency: input.fiatCurrency,
      netFiatAmount: String(breakdown.netFiat),
      // Raw pre-spread market rate — stored for treasury/audit.
      baseRate: String(rate.baseRate),
      // Effective (spread-reduced) rate — what the user receives per crypto unit.
      fxRate: String(breakdown.effectiveRate),
      // Reports the APPLIED (direction-specific) spread — the sell spread for sell quotes.
      spreadBps: rate.sellSpreadBps,
      processingFeeBps: rate.processingFeeBps,
      processingFeeAmount: String(breakdown.processingFeeAmount),
      quotedAt: this.clock.now().toISOString(),
      expiresInSec: rate.expiresInSec,
    };
  }
}
