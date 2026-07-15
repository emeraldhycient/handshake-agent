/**
 * Unit tests for MockSanctionsScreener (N2).
 *
 * TDD: written before the implementation to drive the design (RED first).
 *
 * Behaviour:
 *   - Any address NOT in the denylist → { passed: true, provider: 'mock', reference: 'mock-sanctions-...' }
 *   - Any address IN the denylist → { passed: false, reason: 'sanctioned address', provider: 'mock', reference: 'mock-sanctions-...' }
 *   - Each call produces a distinct reference.
 */

import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { MockSanctionsScreener } from './mock-sanctions.screener';

// ── Known denylist fixture ──────────────────────────────────────────────────

const BLOCKED_ADDRESS = 'TBlocked0000000000000000000000000BAD';
const CLEAN_ADDRESS = 'TClean0000000000000000000000000CLEAN';

/**
 * Builds a minimal EffectiveConfigService stub that returns the given denylist
 * from `config.get('compliance')`.  This mirrors the production wiring in
 * AppModule (EffectiveConfigModule is global) while keeping the unit tests fast
 * and hermetic; a DB AppSetting override would change the denylist returned here.
 */
function stubConfigService(denylist: string[]): EffectiveConfigService {
  return {
    get: (key: string) => {
      if (key === 'compliance') {
        return {
          travelRuleThresholds: { NGN: 1_000_000 },
          sanctionsDenylist: denylist,
        };
      }
      return undefined;
    },
  } as unknown as EffectiveConfigService;
}

function makeScreener(
  denylist: string[] = [BLOCKED_ADDRESS],
): MockSanctionsScreener {
  process.env['SANCTIONS_MOCK_MODE'] = 'true';
  return new MockSanctionsScreener(stubConfigService(denylist));
}

// ---------------------------------------------------------------------------

describe('MockSanctionsScreener', () => {
  describe('screen — passed paths', () => {
    it('returns passed:true for a clean address not on the denylist', async () => {
      const screener = makeScreener();

      const result = await screener.screen({
        address: CLEAN_ADDRESS,
        network: 'tron',
      });

      expect(result.passed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.provider).toBe('mock');
      expect(result.reference).toMatch(/^mock-sanctions-/);
    });

    it('passes when denylist is empty', async () => {
      const screener = makeScreener([]);

      const result = await screener.screen({
        address: BLOCKED_ADDRESS,
        network: 'tron',
      });

      expect(result.passed).toBe(true);
    });

    it('passes when userId is included alongside a clean address', async () => {
      const screener = makeScreener();

      const result = await screener.screen({
        address: CLEAN_ADDRESS,
        network: 'evm',
        userId: 'user-uuid-abc',
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('screen — blocked paths', () => {
    it('returns passed:false and reason for a denylisted address', async () => {
      const screener = makeScreener();

      const result = await screener.screen({
        address: BLOCKED_ADDRESS,
        network: 'tron',
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('sanctioned address');
      expect(result.provider).toBe('mock');
      expect(result.reference).toMatch(/^mock-sanctions-/);
    });

    it('is case-sensitive — exact address match required', async () => {
      const screener = makeScreener([BLOCKED_ADDRESS]);

      // Lower-cased version of the blocked address: should pass
      const result = await screener.screen({
        address: BLOCKED_ADDRESS.toLowerCase(),
        network: 'tron',
      });

      expect(result.passed).toBe(true);
    });

    it('flags a second denylisted address when multiple entries are configured', async () => {
      const SECOND_BAD = 'TSecondBad000000000000000000000BAD2';
      const screener = makeScreener([BLOCKED_ADDRESS, SECOND_BAD]);

      const r1 = await screener.screen({
        address: BLOCKED_ADDRESS,
        network: 'tron',
      });
      const r2 = await screener.screen({ address: SECOND_BAD, network: 'evm' });

      expect(r1.passed).toBe(false);
      expect(r2.passed).toBe(false);
    });
  });

  describe('AppSetting override', () => {
    it('blocks an address added to the denylist via a DB override (EffectiveConfigService flows through)', async () => {
      // An address that is clean against the base denylist must be blocked once
      // an admin adds it to compliance.sanctionsDenylist via AppSetting.
      const OVERRIDE_BAD = 'TOverrideBad00000000000000000000BAD3';
      const screener = makeScreener([OVERRIDE_BAD]);

      const result = await screener.screen({
        address: OVERRIDE_BAD,
        network: 'tron',
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('sanctioned address');
    });
  });

  describe('reference uniqueness', () => {
    it('generates a distinct reference for each call', async () => {
      const screener = makeScreener();

      const [r1, r2] = await Promise.all([
        screener.screen({ address: CLEAN_ADDRESS, network: 'tron' }),
        screener.screen({ address: CLEAN_ADDRESS, network: 'evm' }),
      ]);

      expect(r1.reference).not.toBe(r2.reference);
    });
  });

  // ── Identity screen (counterparty-user path, Task 8 fix) ──────────────────
  // Reuses the SAME denylist config as address screening, but keys on userId —
  // so a test forces a block by denylisting the counterparty's userId.
  describe('screenIdentity', () => {
    const CLEAN_USER_ID = 'user-clean-001';
    const BLOCKED_USER_ID = 'user-sanctioned-999';

    it('passes a clean userId not on the denylist', async () => {
      const screener = makeScreener([BLOCKED_USER_ID]);

      const result = await screener.screenIdentity({ userId: CLEAN_USER_ID });

      expect(result.passed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.provider).toBe('mock');
      expect(result.reference).toMatch(/^mock-sanctions-/);
    });

    it('blocks a userId present in the denylist', async () => {
      const screener = makeScreener([BLOCKED_USER_ID]);

      const result = await screener.screenIdentity({
        userId: BLOCKED_USER_ID,
      });

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('sanctioned identity');
      expect(result.provider).toBe('mock');
      expect(result.reference).toMatch(/^mock-sanctions-/);
    });

    it('uses a caller-supplied reference when provided', async () => {
      const screener = makeScreener([BLOCKED_USER_ID]);

      const result = await screener.screenIdentity({
        userId: CLEAN_USER_ID,
        reference: 'caller-ref-123',
      });

      expect(result.reference).toBe('caller-ref-123');
    });
  });
});
