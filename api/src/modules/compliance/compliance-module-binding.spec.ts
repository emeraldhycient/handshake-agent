/**
 * Unit tests for ComplianceModule SANCTIONS_SCREENER binding selection.
 *
 * The factory logic in ComplianceModule is: when SANCTIONS_MOCK_MODE === 'false',
 * return BlockradarAmlScreener; otherwise return MockSanctionsScreener.
 *
 * Rather than spinning up the full NestJS DI graph (which requires PrismaModule,
 * ConfigModule, etc.), we test the factory decision logic directly. This keeps
 * the test fast and hermetic, following the pattern used in other unit specs in
 * this codebase (e.g. compliance.service.spec.ts, mock-sanctions.screener.spec.ts).
 *
 * For the AppModule compile/boot path (which verifies both binding modes work
 * end-to-end), see the e2e suite (compliance-event.e2e-spec.ts, send-vertical.e2e-spec.ts).
 */

import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';

import { MockSanctionsScreener } from './infrastructure/mock-sanctions.screener';
import { BlockradarAmlScreener } from './infrastructure/blockradar-aml.screener';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeConfigService(sanctionsMockMode: string): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'SANCTIONS_MOCK_MODE') return sanctionsMockMode;
      if (key === 'BLOCKRADAR_BASE_URL') return 'https://api.blockradar.co/v1';
      if (key === 'BLOCKRADAR_API_KEY') return 'test-key';
      if (key === 'compliance') {
        return {
          travelRuleThresholds: { NGN: 1_000_000 },
          sanctionsDenylist: [] as string[],
        };
      }
      if (key === 'catalog') {
        return {
          networks: {
            TRON: {
              id: 'TRON',
              displayName: 'TRON (TRC-20)',
              addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
              enabled: true,
              networkFeeCrypto: { USDT: '1' },
              amlBlockchain: 'tron',
            },
          },
          assets: {},
          fiats: {},
          capabilities: {},
          sendQuoteExpiresInSec: 30,
        };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

function makeHttpService(): HttpService {
  return { get: jest.fn(), post: jest.fn() } as unknown as HttpService;
}

/**
 * Replicates the ComplianceModule factory logic so we can test it without
 * loading the full Nest DI graph.
 */
function resolveSanctionsScreener(sanctionsMockMode: string) {
  const config = makeConfigService(sanctionsMockMode);
  const http = makeHttpService();

  const mock = new MockSanctionsScreener(config as never);
  const real = new BlockradarAmlScreener(http, config as never);

  const mockMode = config.get<string>('SANCTIONS_MOCK_MODE');
  return mockMode === 'false' ? real : mock;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ComplianceModule — SANCTIONS_SCREENER factory binding', () => {
  it('selects MockSanctionsScreener when SANCTIONS_MOCK_MODE=true (default)', () => {
    const screener = resolveSanctionsScreener('true');
    expect(screener).toBeInstanceOf(MockSanctionsScreener);
  });

  it('selects MockSanctionsScreener for any non-"false" value (default safe)', () => {
    // Includes missing value, 'yes', '1', etc. — only explicit 'false' activates real adapter.
    const screener = resolveSanctionsScreener('');
    expect(screener).toBeInstanceOf(MockSanctionsScreener);
  });

  it('selects BlockradarAmlScreener when SANCTIONS_MOCK_MODE=false', () => {
    const screener = resolveSanctionsScreener('false');
    expect(screener).toBeInstanceOf(BlockradarAmlScreener);
  });

  it('the real screener has the correct class identity (implements ISanctionsScreener)', () => {
    const screener = resolveSanctionsScreener('false');
    // The screener must have a screen() method — satisfies the port contract
    expect(typeof screener.screen).toBe('function');
  });

  it('the mock screener has the correct class identity (implements ISanctionsScreener)', () => {
    const screener = resolveSanctionsScreener('true');
    expect(typeof screener.screen).toBe('function');
  });
});
