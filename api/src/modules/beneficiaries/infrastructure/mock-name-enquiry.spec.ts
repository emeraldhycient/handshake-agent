/**
 * TDD — mock-name-enquiry.spec.ts (Fix E)
 *
 * RED first: tests drive the MockNameEnquiry design before the implementation
 * exists.
 *
 * Behaviour:
 *   - resolve() returns { accountName, provider:'mock', reference:'mock-name-enquiry-...' }
 *     for any non-bad-account input.
 *   - The resolved accountName is a deterministic fixture (NOT the caller-supplied name):
 *     the default is "MOCK ACCOUNT HOLDER"; a custom fixture can be set via config.
 *   - A configured bad account number → throws NameEnquiryFailedError.
 *   - Each call produces a distinct reference.
 */

import { ConfigService } from '@nestjs/config';

import { MockNameEnquiry } from './mock-name-enquiry';
import { NameEnquiryFailedError } from '../domain/beneficiary-errors';
import type { AppConfig } from '../../../core/config/configuration';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOOD_ACCOUNT = '0123456789';
const BAD_ACCOUNT = '9999999999'; // the configured "not found" account

/**
 * Builds a minimal ConfigService stub that returns beneficiary config from
 * `config.get('beneficiary')`. Mirrors the production wiring in AppModule.
 */
function stubConfigService(opts: {
  badAccountNumber?: string;
  resolvedName?: string;
}): ConfigService<AppConfig, true> {
  return {
    get: (key: string) => {
      if (key === 'beneficiary') {
        return {
          cryptoCoolingOffSeconds: 86_400,
          nameEnquiryBadAccount: opts.badAccountNumber ?? '',
          nameEnquiryResolvedName: opts.resolvedName ?? '',
        };
      }
      return undefined;
    },
  } as unknown as ConfigService<AppConfig, true>;
}

function makeEnquiry(
  badAccount = BAD_ACCOUNT,
  resolvedName?: string,
): MockNameEnquiry {
  process.env['NAME_ENQUIRY_MOCK_MODE'] = 'true';
  return new MockNameEnquiry(
    stubConfigService({ badAccountNumber: badAccount, resolvedName }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MockNameEnquiry', () => {
  describe('resolve — happy path', () => {
    it('returns resolved accountName, provider:mock, and a reference for a normal account', async () => {
      const enquiry = makeEnquiry();

      const result = await enquiry.resolve({
        bankCode: '058',
        accountNumber: GOOD_ACCOUNT,
      });

      expect(result.accountName).toBeTruthy();
      expect(result.provider).toBe('mock');
      expect(result.reference).toMatch(/^mock-name-enquiry-/);
    });

    it('returns the default resolved name when no custom name is configured', async () => {
      const enquiry = makeEnquiry();

      const result = await enquiry.resolve({
        bankCode: '033',
        accountNumber: GOOD_ACCOUNT,
      });

      expect(result.accountName).toBe('MOCK ACCOUNT HOLDER');
    });

    it('returns a custom configured resolved name when set', async () => {
      const enquiry = makeEnquiry(BAD_ACCOUNT, 'ADAEZE OKAFOR');

      const result = await enquiry.resolve({
        bankCode: '058',
        accountNumber: GOOD_ACCOUNT,
      });

      expect(result.accountName).toBe('ADAEZE OKAFOR');
    });

    it('generates a distinct reference on each call', async () => {
      const enquiry = makeEnquiry();

      const [r1, r2] = await Promise.all([
        enquiry.resolve({ bankCode: '058', accountNumber: GOOD_ACCOUNT }),
        enquiry.resolve({ bankCode: '033', accountNumber: GOOD_ACCOUNT }),
      ]);

      expect(r1.reference).not.toBe(r2.reference);
    });
  });

  describe('resolve — bad account (simulated not-found)', () => {
    it('throws NameEnquiryFailedError for the configured bad account', async () => {
      const enquiry = makeEnquiry();

      await expect(
        enquiry.resolve({ bankCode: '058', accountNumber: BAD_ACCOUNT }),
      ).rejects.toThrow(NameEnquiryFailedError);
    });

    it('does NOT throw when the bad account config is empty (no accounts configured as bad)', async () => {
      const enquiry = makeEnquiry(''); // no bad account configured

      await expect(
        enquiry.resolve({ bankCode: '058', accountNumber: BAD_ACCOUNT }),
      ).resolves.toBeDefined();
    });

    it('error message mentions the bank code and account number', async () => {
      const enquiry = makeEnquiry();

      const err = await enquiry
        .resolve({ bankCode: '058', accountNumber: BAD_ACCOUNT })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NameEnquiryFailedError);
      expect((err as Error).message).toContain(BAD_ACCOUNT);
      expect((err as Error).message).toContain('058');
    });
  });
});
