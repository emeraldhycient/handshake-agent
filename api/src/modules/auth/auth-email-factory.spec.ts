/**
 * Unit tests for the EMAIL_PROVIDER factory selection in WebAuthModule.
 *
 * Verifies that:
 *   - RESEND_API_KEY present/non-empty → ResendEmailProvider
 *   - RESEND_API_KEY absent/empty      → MockEmailProvider
 *
 * TDD: written before the implementation (red → green → refactor).
 */

import { ConfigService } from '@nestjs/config';

import { MockEmailProvider } from './infrastructure/mock-email.provider';
import { ResendEmailProvider } from './infrastructure/resend-email.provider';
import { selectEmailProvider } from './auth.module';

function makeConfig(resendApiKey: string | undefined): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'RESEND_API_KEY') return resendApiKey;
      return undefined;
    },
  } as unknown as ConfigService;
}

describe('selectEmailProvider (EMAIL_PROVIDER factory)', () => {
  let mock: MockEmailProvider;
  let real: ResendEmailProvider;

  beforeEach(() => {
    // Minimal stubs — the factory only cares about the ConfigService value.
    mock = {} as MockEmailProvider;
    real = {} as ResendEmailProvider;
  });

  it('returns ResendEmailProvider when RESEND_API_KEY is a non-empty string', () => {
    const result = selectEmailProvider(
      mock,
      real,
      makeConfig('re_test_ABC123'),
    );
    expect(result).toBe(real);
  });

  it('returns MockEmailProvider when RESEND_API_KEY is undefined', () => {
    const result = selectEmailProvider(mock, real, makeConfig(undefined));
    expect(result).toBe(mock);
  });

  it('returns MockEmailProvider when RESEND_API_KEY is an empty string', () => {
    const result = selectEmailProvider(mock, real, makeConfig(''));
    expect(result).toBe(mock);
  });
});
