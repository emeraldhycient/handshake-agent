/**
 * Unit tests for MockKycProvider.createVerificationSession.
 *
 * `verify()` was removed from IKycProvider (task 6 of
 * docs/superpowers/plans/2026-07-13-retire-legacy-sync-kyc-endpoints.md) —
 * its legacy NIN/BVN auto-approval tests were removed with it. The mock's
 * `createVerificationSession` is also exercised end-to-end by the
 * `kyc-sumsub-token` e2e suite.
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
// createVerificationSession (task 3.3) — deterministic fake token/applicantId
// ---------------------------------------------------------------------------

describe('MockKycProvider', () => {
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
