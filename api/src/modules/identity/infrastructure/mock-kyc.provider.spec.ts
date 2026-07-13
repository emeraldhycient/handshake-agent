/**
 * Unit tests for MockKycProvider.
 *
 * The legacy synchronous `verify()` NIN/BVN path was removed from source
 * (retired with `POST /kyc/complete` + `/kyc/submit`); its tests are gone with
 * it. The mock now implements only `createVerificationSession` — a
 * deterministic fake WebSDK token/applicantId for tier_2/tier_3 upgrades.
 */

import { MockKycProvider } from './mock-kyc.provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(): MockKycProvider {
  // MockKycProvider reads KYC_MOCK_MODE from env; set it for unit tests.
  process.env['KYC_MOCK_MODE'] = 'true';
  return new MockKycProvider();
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('MockKycProvider', () => {
  // -------------------------------------------------------------------------
  // createVerificationSession (task 3.3) — deterministic fake token/applicantId
  // -------------------------------------------------------------------------

  describe('createVerificationSession', () => {
    it('returns a deterministic token and applicantId for tier_2', async () => {
      const provider = makeProvider();

      const result = await provider.createVerificationSession({
        userId: 'user-123',
        level: 'tier_2',
      });

      expect(result).toEqual({
        token: 'mock-user-123-tier_2',
        applicantId: 'mock-app-user-123',
      });
    });

    it('returns a deterministic token and applicantId for tier_3', async () => {
      const provider = makeProvider();

      const result = await provider.createVerificationSession({
        userId: 'user-456',
        level: 'tier_3',
      });

      expect(result).toEqual({
        token: 'mock-user-456-tier_3',
        applicantId: 'mock-app-user-456',
      });
    });

    it('is deterministic — the same input always produces the same output', async () => {
      const provider = makeProvider();

      const first = await provider.createVerificationSession({
        userId: 'user-789',
        level: 'tier_2',
      });
      const second = await provider.createVerificationSession({
        userId: 'user-789',
        level: 'tier_2',
      });

      expect(first).toEqual(second);
    });
  });
});
