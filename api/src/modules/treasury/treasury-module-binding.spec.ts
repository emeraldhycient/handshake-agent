/**
 * Unit tests for TreasuryModule PAYMENT_PROVIDER binding selection.
 *
 * The factory logic in TreasuryModule is: when PAYMENTS_MOCK_MODE === 'false',
 * return the real FlutterwaveProvider; otherwise (default 'true', or any other
 * value) return MockPaymentProvider.
 *
 * Following the ComplianceModule binding test pattern, we exercise the factory
 * decision directly (the exported `selectPaymentProvider` helper the module
 * uses) rather than booting the full NestJS DI graph — fast and hermetic.
 */
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { selectPaymentProvider } from './treasury.module';
import { MockPaymentProvider } from './infrastructure/mock-payment.provider';
import { FlutterwaveProvider } from './infrastructure/flutterwave.provider';

function makeConfigService(paymentsMockMode: string): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'PAYMENTS_MOCK_MODE') return paymentsMockMode;
      if (key === 'FLUTTERWAVE_BASE_URL')
        return 'https://api.flutterwave.com/v3';
      if (key === 'FLUTTERWAVE_SECRET_KEY') return 'FLWSECK_TEST-key';
      if (key === 'FLUTTERWAVE_WEBHOOK_SECRET') return '';
      return undefined;
    },
  } as unknown as ConfigService;
}

function makeHttpService(): HttpService {
  return { get: jest.fn(), post: jest.fn() } as unknown as HttpService;
}

function resolve(paymentsMockMode: string) {
  const config = makeConfigService(paymentsMockMode);
  const mock = new MockPaymentProvider();
  const real = new FlutterwaveProvider(makeHttpService(), config);
  return selectPaymentProvider(mock, real, config);
}

describe('TreasuryModule — PAYMENT_PROVIDER factory binding', () => {
  it('selects MockPaymentProvider when PAYMENTS_MOCK_MODE=true (default)', () => {
    expect(resolve('true')).toBeInstanceOf(MockPaymentProvider);
  });

  it('selects MockPaymentProvider for any non-"false" value (default safe)', () => {
    // Includes missing value, 'yes', '1', etc. — only explicit 'false' goes real.
    expect(resolve('')).toBeInstanceOf(MockPaymentProvider);
  });

  it('selects the real FlutterwaveProvider when PAYMENTS_MOCK_MODE=false', () => {
    expect(resolve('false')).toBeInstanceOf(FlutterwaveProvider);
  });

  it('the selected provider satisfies the port (has createCollection)', () => {
    expect(typeof resolve('false').createCollection).toBe('function');
    expect(typeof resolve('true').createCollection).toBe('function');
  });
});
