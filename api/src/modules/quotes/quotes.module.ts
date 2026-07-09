import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { LiveRateStore } from './application/live-rate.store';
import { RATE_PROVIDER } from './application/ports/rate-provider.port';
import { QuotesService } from './application/quotes.service';
import { RatesService } from './application/rates.service';
import { ConfigRateProvider } from './infrastructure/config-rate.provider';
import { LiveRateService } from './infrastructure/live-rate.service';
import { QuotesController } from './presentation/quotes.controller';

/**
 * Wires the quotes vertical slice. The application layer binds to abstractions
 * (RATE_PROVIDER, CLOCK); infrastructure supplies the concrete implementations.
 *
 * F1 live market-rate feed: LiveRateStore is the process-local rate cache and
 * LiveRateService the scheduled poller that fills it. The store is EXPORTED so
 * the base-rate resolution seam in the transactions engine and the wallets swap
 * cross-rate resolve the SAME live rate as the quote adapter (CLAUDE.md §3.1) —
 * mirroring the exported RATE_PROVIDER pattern. HttpModule gives the poller an
 * HttpService (the Flutterwave/Blockradar axios pattern; no mock-mode flag).
 */
@Module({
  imports: [HttpModule],
  controllers: [QuotesController],
  providers: [
    QuotesService,
    RatesService,
    LiveRateStore,
    LiveRateService,
    { provide: RATE_PROVIDER, useClass: ConfigRateProvider },
    { provide: CLOCK, useClass: SystemClock },
  ],
  // RATE_PROVIDER is exported so read-only consumers (the wallet balance
  // valuation) can inject the rate source without re-binding it. LiveRateStore is
  // exported so TransactionsModule (proposal/execution engine) and WalletsModule
  // (mock-swap cross-rate) read the same live rates the quote path does.
  // RatesService is exported so the agent + MCP modules can inject the read-only
  // rate-discovery use-case (Wave K) — same folded rate the engine transacts at.
  exports: [QuotesService, RatesService, RATE_PROVIDER, LiveRateStore],
})
export class QuotesModule {}
