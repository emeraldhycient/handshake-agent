/**
 * Unit tests for MockKycProvider (task K1).
 *
 * The mock auto-approves Tier-1 when (nin OR bvn) AND firstName AND lastName
 * are all non-empty. Otherwise it returns approved:false with tier:'unverified'.
 *
 * TDD: written before the implementation to drive the design.
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
  describe('verify — approved paths', () => {
    it('approves at tier_1 when nin + firstName + lastName are present', async () => {
      const provider = makeProvider();

      const result = await provider.verify({
        nin: '12345678901',
        firstName: 'Amaka',
        lastName: 'Okonkwo',
      });

      expect(result.approved).toBe(true);
      expect(result.tier).toBe('tier_1');
      expect(result.reference).toMatch(/^mock-kyc-/);
      expect(result.reason).toBeUndefined();
    });

    it('approves at tier_1 when bvn (no nin) + firstName + lastName are present', async () => {
      const provider = makeProvider();

      const result = await provider.verify({
        bvn: '22234567890',
        firstName: 'Chukwuemeka',
        lastName: 'Eze',
      });

      expect(result.approved).toBe(true);
      expect(result.tier).toBe('tier_1');
      expect(result.reference).toMatch(/^mock-kyc-/);
    });

    it('approves when both nin and bvn are supplied (uses either)', async () => {
      const provider = makeProvider();

      const result = await provider.verify({
        nin: '11111111111',
        bvn: '22222222222',
        firstName: 'Ngozi',
        lastName: 'Adeyemi',
      });

      expect(result.approved).toBe(true);
      expect(result.tier).toBe('tier_1');
    });

    it('includes an optional dateOfBirth without affecting approval', async () => {
      const provider = makeProvider();

      const result = await provider.verify({
        nin: '98765432100',
        firstName: 'Tunde',
        lastName: 'Balogun',
        dateOfBirth: '1990-05-15',
      });

      expect(result.approved).toBe(true);
      expect(result.tier).toBe('tier_1');
    });
  });

  describe('verify — rejected paths', () => {
    it('rejects when neither nin nor bvn is present', async () => {
      const provider = makeProvider();

      const result = await provider.verify({
        firstName: 'Adaeze',
        lastName: 'Nwosu',
      });

      expect(result.approved).toBe(false);
      expect(result.tier).toBe('unverified');
      expect(result.reference).toMatch(/^mock-kyc-/);
      expect(result.reason).toMatch(/missing/i);
    });

    it('rejects when firstName is empty (nin present)', async () => {
      const provider = makeProvider();

      const result = await provider.verify({
        nin: '12345678901',
        firstName: '',
        lastName: 'Obi',
      });

      expect(result.approved).toBe(false);
      expect(result.tier).toBe('unverified');
      expect(result.reason).toMatch(/missing/i);
    });

    it('rejects when lastName is empty (nin present)', async () => {
      const provider = makeProvider();

      const result = await provider.verify({
        nin: '12345678901',
        firstName: 'Chidera',
        lastName: '',
      });

      expect(result.approved).toBe(false);
      expect(result.tier).toBe('unverified');
      expect(result.reason).toMatch(/missing/i);
    });

    it('rejects when firstName is whitespace-only', async () => {
      const provider = makeProvider();

      const result = await provider.verify({
        bvn: '22234567890',
        firstName: '   ',
        lastName: 'Okonkwo',
      });

      expect(result.approved).toBe(false);
      expect(result.tier).toBe('unverified');
    });
  });

  describe('reference uniqueness', () => {
    it('generates a distinct reference for each call', async () => {
      const provider = makeProvider();

      const [r1, r2] = await Promise.all([
        provider.verify({ nin: '11111111111', firstName: 'A', lastName: 'B' }),
        provider.verify({ nin: '22222222222', firstName: 'C', lastName: 'D' }),
      ]);

      expect(r1.reference).not.toBe(r2.reference);
    });
  });
});
