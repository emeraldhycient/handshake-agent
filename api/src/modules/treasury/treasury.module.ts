import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { PAYMENT_PROVIDER } from './application/ports/payment-provider.port';
import { FlutterwaveProvider } from './infrastructure/flutterwave.provider';

/**
 * Treasury feature module.
 *
 * Provides the fiat pay-in capability (NGN virtual-account collection) via
 * the `IPaymentProvider` port, bound to the `FlutterwaveProvider` adapter.
 *
 * - ConfigModule is global — ConfigService is already in the DI container.
 * - HttpModule is imported here for the Flutterwave HTTP client.
 * - No DB access in this module (Task 5.2 scope; engine persistence in 4.5).
 */
@Module({
  imports: [HttpModule],
  providers: [{ provide: PAYMENT_PROVIDER, useClass: FlutterwaveProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class TreasuryModule {}
