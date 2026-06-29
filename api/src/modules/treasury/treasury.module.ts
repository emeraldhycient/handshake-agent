import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import {
  PAYMENT_PROVIDER,
  type IPaymentProvider,
} from './application/ports/payment-provider.port';
import { FlutterwaveProvider } from './infrastructure/flutterwave.provider';
import { MockPaymentProvider } from './infrastructure/mock-payment.provider';

/**
 * Selects the active payment adapter from the layered config.
 *
 *   PAYMENTS_MOCK_MODE=true  (env-schema default) → MockPaymentProvider
 *   PAYMENTS_MOCK_MODE=false                       → FlutterwaveProvider (live)
 *
 * Default is mock (safe): only an explicit 'false' activates real Flutterwave
 * calls. Mirrors KYC_MOCK_MODE / SANCTIONS_MOCK_MODE. Exported so the binding
 * decision can be unit-tested without booting the full DI graph.
 */
export function selectPaymentProvider(
  mock: MockPaymentProvider,
  real: FlutterwaveProvider,
  config: ConfigService,
): IPaymentProvider {
  return config.get<string>('PAYMENTS_MOCK_MODE') === 'false' ? real : mock;
}

/**
 * Treasury feature module.
 *
 * Provides the fiat pay-in / pay-out capability (NGN virtual-account collection
 * and bank transfer) via the `IPaymentProvider` port. The port is bound to
 * either the mock or the real Flutterwave adapter, selected at boot from
 * `PAYMENTS_MOCK_MODE` (see {@link selectPaymentProvider}).
 *
 * - ConfigModule is global — ConfigService is already in the DI container.
 * - HttpModule is imported here for the Flutterwave HTTP client.
 * - Both adapters are registered as providers so the factory can inject either.
 * - No DB access in this module.
 */
@Module({
  imports: [HttpModule],
  providers: [
    MockPaymentProvider,
    FlutterwaveProvider,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: selectPaymentProvider,
      inject: [MockPaymentProvider, FlutterwaveProvider, ConfigService],
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class TreasuryModule {}
