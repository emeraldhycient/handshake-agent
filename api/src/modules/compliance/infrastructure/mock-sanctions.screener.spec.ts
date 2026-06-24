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

import { ConfigService } from '@nestjs/config';

import { MockSanctionsScreener } from './mock-sanctions.screener';
import type { AppConfig } from '../../../core/config/configuration';

// ── Known denylist fixture ──────────────────────────────────────────────────

const BLOCKED_ADDRESS = 'TBlocked0000000000000000000000000BAD';
const CLEAN_ADDRESS = 'TClean0000000000000000000000000CLEAN';

/**
 * Builds a minimal ConfigService stub that returns the given denylist
 * from `config.get('compliance')`.  This mirrors the production wiring
 * in AppModule (ConfigModule is global; ConfigService is always injectable)
 * while keeping the unit tests fast and hermetic.
 */
function stubConfigService(denylist: string[]): ConfigService<AppConfig, true> {
  return {
    get: (key: string) => {
      if (key === 'compliance') {
        return {
          travelRuleThresholdNgn: 1_000_000,
          sanctionsDenylist: denylist,
        };
      }
      return undefined;
    },
  } as unknown as ConfigService<AppConfig, true>;
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
});
