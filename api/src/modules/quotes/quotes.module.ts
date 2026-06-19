import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { RATE_PROVIDER } from './application/ports/rate-provider.port';
import { QuotesService } from './application/quotes.service';
import { ConfigRateProvider } from './infrastructure/config-rate.provider';
import { QuotesController } from './presentation/quotes.controller';

/**
 * Wires the quotes vertical slice. The application layer binds to abstractions
 * (RATE_PROVIDER, CLOCK); infrastructure supplies the concrete implementations.
 */
@Module({
  controllers: [QuotesController],
  providers: [
    QuotesService,
    { provide: RATE_PROVIDER, useClass: ConfigRateProvider },
    { provide: CLOCK, useClass: SystemClock },
  ],
})
export class QuotesModule {}
