/**
 * Unit tests for BlockradarAmlScreener (fix-AML).
 *
 * TDD: written against the spec in .superpowers/sdd/fix-AML-brief.md.
 *
 * HttpService is mocked — no live Blockradar calls in CI.
 * ConfigService is stubbed to return Blockradar env values; EffectiveConfigService
 * is stubbed to return the (admin-tunable) catalog.
 *
 * Verifies:
 *   - isBlacklisted:true → passed:false, correct reason + provider 'blockradar'
 *   - isBlacklisted:false → passed:true, provider 'blockradar'
 *   - GET URL path, address + blockchain query params, x-api-key header
 *   - TRON → "tron" mapping via the catalog amlBlockchain field
 *   - Unknown network (no amlBlockchain entry) → throws SanctionsScreeningUnavailableError
 *   - Non-2xx HTTP error → throws SanctionsScreeningUnavailableError (fail-closed, NOT passed:true)
 *   - Network/timeout error → throws SanctionsScreeningUnavailableError (fail-closed)
 *   - Transient 5xx: retries once, returns on retry success
 *   - 4xx: does not retry, throws immediately
 */

import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosError, AxiosResponse } from 'axios';

import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { BlockradarAmlScreener } from './blockradar-aml.screener';
import { SanctionsScreeningUnavailableError } from '../domain/compliance-errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.blockradar.co/v1';
const API_KEY = 'test-blockradar-key';
const TRON_ADDRESS = 'TXyz000000000000000000000000000000001';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** Env-only stub (ConfigService) — Blockradar flat env keys (infra/secrets). */
function makeEnvConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const base: Record<string, unknown> = {
    BLOCKRADAR_BASE_URL: BASE_URL,
    BLOCKRADAR_API_KEY: API_KEY,
    ...overrides,
  };
  return {
    get: (key: string) => base[key],
  } as unknown as ConfigService;
}

/**
 * Catalog stub (EffectiveConfigService) — the admin-tunable `catalog` section.
 * Passing `catalog` overrides simulates a DB AppSetting override of the network
 * → amlBlockchain mapping flowing through to the screener.
 */
function makeEffectiveConfig(
  catalogOverride?: unknown,
): EffectiveConfigService {
  const catalog = catalogOverride ?? {
    networks: {
      TRON: {
        id: 'TRON',
        displayName: 'TRON (TRC-20)',
        addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
        enabled: true,
        networkFeeCrypto: { USDT: '1' },
        amlBlockchain: 'tron',
      },
      // Network without amlBlockchain — simulates a misconfigured entry
      BADNET: {
        id: 'BADNET',
        displayName: 'Bad Network',
        addressPattern: '.*',
        enabled: true,
        networkFeeCrypto: {},
        // amlBlockchain intentionally absent
      },
    },
  };
  return {
    get: (key: string) => (key === 'catalog' ? catalog : undefined),
  } as unknown as EffectiveConfigService;
}

function axiosOk<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} as never },
  };
}

function axiosError(status: number, message = 'Error'): AxiosError {
  const err = new Error(message) as AxiosError;
  err.isAxiosError = true;
  err.response = {
    data: { message },
    status,
    statusText: String(status),
    headers: {},
    config: { headers: {} as never },
  };
  return err;
}

function networkError(): AxiosError {
  const err = new Error('ECONNRESET') as AxiosError;
  err.isAxiosError = true;
  // No .response — network-level failure
  return err;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('BlockradarAmlScreener', () => {
  let http: jest.Mocked<HttpService>;
  let screener: BlockradarAmlScreener;

  beforeEach(() => {
    http = {
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
    screener = new BlockradarAmlScreener(
      http,
      makeEnvConfig(),
      makeEffectiveConfig(),
    );
  });

  // ── Passed (not blacklisted) ───────────────────────────────────────────────

  describe('clean address (isBlacklisted: false)', () => {
    beforeEach(() => {
      http.get.mockReturnValue(
        of(
          axiosOk({
            data: { isBlacklisted: false },
            message: 'OK',
            statusCode: 200,
          }),
        ),
      );
    });

    it('returns passed:true', async () => {
      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });
      expect(result.passed).toBe(true);
    });

    it('sets provider to "blockradar"', async () => {
      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });
      expect(result.provider).toBe('blockradar');
    });

    it('returns a non-empty reference (uuid)', async () => {
      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });
      expect(result.reference).toBeTruthy();
      expect(typeof result.reference).toBe('string');
    });

    it('does not set reason', async () => {
      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });
      expect(result.reason).toBeUndefined();
    });
  });

  // ── Flagged (blacklisted) ─────────────────────────────────────────────────

  describe('flagged address (isBlacklisted: true)', () => {
    beforeEach(() => {
      http.get.mockReturnValue(
        of(
          axiosOk({
            data: { isBlacklisted: true },
            message: 'OK',
            statusCode: 200,
          }),
        ),
      );
    });

    it('returns passed:false', async () => {
      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });
      expect(result.passed).toBe(false);
    });

    it('sets reason to the expected message', async () => {
      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });
      expect(result.reason).toBe('blacklisted address (Blockradar AML)');
    });

    it('sets provider to "blockradar"', async () => {
      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });
      expect(result.provider).toBe('blockradar');
    });

    it('returns a non-empty reference', async () => {
      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });
      expect(result.reference).toBeTruthy();
    });
  });

  // ── GET URL, params, and header ───────────────────────────────────────────

  describe('HTTP request shape', () => {
    beforeEach(() => {
      http.get.mockReturnValue(
        of(
          axiosOk({
            data: { isBlacklisted: false },
            message: 'OK',
            statusCode: 200,
          }),
        ),
      );
    });

    it('calls GET on the /aml/lookup path', async () => {
      await screener.screen({ address: TRON_ADDRESS, network: 'TRON' });

      expect(http.get).toHaveBeenCalledTimes(1);
      const [url] = http.get.mock.calls[0] as [string, unknown];
      expect(url).toBe(`${BASE_URL}/aml/lookup`);
    });

    it('passes address and blockchain as query params', async () => {
      await screener.screen({ address: TRON_ADDRESS, network: 'TRON' });

      const [, config] = http.get.mock.calls[0] as [
        string,
        { params: Record<string, string>; headers: Record<string, string> },
      ];
      expect(config.params.address).toBe(TRON_ADDRESS);
      expect(config.params.blockchain).toBe('tron');
    });

    it('sends x-api-key header', async () => {
      await screener.screen({ address: TRON_ADDRESS, network: 'TRON' });

      const [, config] = http.get.mock.calls[0] as [
        string,
        { params: Record<string, string>; headers: Record<string, string> },
      ];
      expect(config.headers['x-api-key']).toBe(API_KEY);
    });

    it('uses "tron" as blockchain for TRON network (catalog mapping)', async () => {
      await screener.screen({ address: TRON_ADDRESS, network: 'TRON' });

      const [, config] = http.get.mock.calls[0] as [
        string,
        { params: Record<string, string>; headers: Record<string, string> },
      ];
      expect(config.params.blockchain).toBe('tron');
    });

    it('honors a DB AppSetting override of the catalog amlBlockchain mapping (EffectiveConfigService flows through)', async () => {
      // Admin overrides the catalog so TRON maps to a different blockchain id;
      // the override must reach the AML lookup query param via get('catalog').
      const overridden = new BlockradarAmlScreener(
        http,
        makeEnvConfig(),
        makeEffectiveConfig({
          networks: {
            TRON: { id: 'TRON', amlBlockchain: 'tron-shasta' },
          },
        }),
      );

      await overridden.screen({ address: TRON_ADDRESS, network: 'TRON' });

      const [, config] = http.get.mock.calls[0] as [
        string,
        { params: Record<string, string>; headers: Record<string, string> },
      ];
      expect(config.params.blockchain).toBe('tron-shasta');
    });
  });

  // ── Reference uniqueness ──────────────────────────────────────────────────

  it('generates a distinct reference for each call', async () => {
    http.get.mockReturnValue(
      of(
        axiosOk({
          data: { isBlacklisted: false },
          message: 'OK',
          statusCode: 200,
        }),
      ),
    );

    const [r1, r2] = await Promise.all([
      screener.screen({ address: TRON_ADDRESS, network: 'TRON' }),
      screener.screen({ address: TRON_ADDRESS, network: 'TRON' }),
    ]);

    expect(r1.reference).not.toBe(r2.reference);
  });

  // ── Unknown network ───────────────────────────────────────────────────────

  describe('unknown / unmapped network', () => {
    it('throws SanctionsScreeningUnavailableError for a network with no amlBlockchain', async () => {
      await expect(
        screener.screen({ address: TRON_ADDRESS, network: 'BADNET' }),
      ).rejects.toBeInstanceOf(SanctionsScreeningUnavailableError);
    });

    it('throws SanctionsScreeningUnavailableError for a completely unknown network', async () => {
      await expect(
        screener.screen({ address: TRON_ADDRESS, network: 'UNKNOWN_NET' }),
      ).rejects.toBeInstanceOf(SanctionsScreeningUnavailableError);
    });

    it('does NOT call the HTTP endpoint when network mapping is absent (fail-fast)', async () => {
      await expect(
        screener.screen({ address: TRON_ADDRESS, network: 'BADNET' }),
      ).rejects.toBeInstanceOf(SanctionsScreeningUnavailableError);

      expect(http.get).not.toHaveBeenCalled();
    });
  });

  // ── Fail-closed: non-2xx responses ───────────────────────────────────────

  describe('fail-closed on HTTP errors', () => {
    it('throws SanctionsScreeningUnavailableError on a 400 response (not passed:true)', async () => {
      http.get.mockReturnValue(
        throwError(() => axiosError(400, 'Bad Request')),
      );

      await expect(
        screener.screen({ address: TRON_ADDRESS, network: 'TRON' }),
      ).rejects.toBeInstanceOf(SanctionsScreeningUnavailableError);
    });

    it('throws SanctionsScreeningUnavailableError on a 403 response', async () => {
      http.get.mockReturnValue(throwError(() => axiosError(403, 'Forbidden')));

      await expect(
        screener.screen({ address: TRON_ADDRESS, network: 'TRON' }),
      ).rejects.toBeInstanceOf(SanctionsScreeningUnavailableError);
    });

    it('throws SanctionsScreeningUnavailableError on a 500 response after retry', async () => {
      // Both attempts fail with 5xx → should throw after the retry
      http.get.mockReturnValue(
        throwError(() => axiosError(500, 'Internal Server Error')),
      );

      await expect(
        screener.screen({ address: TRON_ADDRESS, network: 'TRON' }),
      ).rejects.toBeInstanceOf(SanctionsScreeningUnavailableError);
    });

    it('NEVER returns passed:true on a non-2xx error (fail-closed)', async () => {
      http.get.mockReturnValue(
        throwError(() => axiosError(503, 'Service Unavailable')),
      );

      let threw = false;
      try {
        await screener.screen({ address: TRON_ADDRESS, network: 'TRON' });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // ── Fail-closed: network/timeout errors ──────────────────────────────────

  describe('fail-closed on network errors', () => {
    it('throws SanctionsScreeningUnavailableError on a network timeout/ECONNRESET', async () => {
      // Both attempts fail with network error → should throw after retry
      http.get.mockReturnValue(throwError(() => networkError()));

      await expect(
        screener.screen({ address: TRON_ADDRESS, network: 'TRON' }),
      ).rejects.toBeInstanceOf(SanctionsScreeningUnavailableError);
    });

    it('NEVER returns passed:true on a network error (fail-closed)', async () => {
      http.get.mockReturnValue(throwError(() => networkError()));

      let threw = false;
      try {
        await screener.screen({ address: TRON_ADDRESS, network: 'TRON' });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // ── Retry logic ───────────────────────────────────────────────────────────

  describe('retry on transient 5xx', () => {
    it('retries once on a 5xx and succeeds on the second attempt', async () => {
      http.get
        .mockReturnValueOnce(
          throwError(() => axiosError(503, 'Service Unavailable')),
        )
        .mockReturnValueOnce(
          of(
            axiosOk({
              data: { isBlacklisted: false },
              message: 'OK',
              statusCode: 200,
            }),
          ),
        );

      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });

      expect(result.passed).toBe(true);
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry on a 4xx (deterministic failure)', async () => {
      http.get.mockReturnValue(
        throwError(() => axiosError(400, 'Bad Request')),
      );

      await expect(
        screener.screen({ address: TRON_ADDRESS, network: 'TRON' }),
      ).rejects.toBeInstanceOf(SanctionsScreeningUnavailableError);

      // Only one call — no retry for 4xx
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it('retries once on network error and succeeds on the second attempt', async () => {
      http.get
        .mockReturnValueOnce(throwError(() => networkError()))
        .mockReturnValueOnce(
          of(
            axiosOk({
              data: { isBlacklisted: true },
              message: 'OK',
              statusCode: 200,
            }),
          ),
        );

      const result = await screener.screen({
        address: TRON_ADDRESS,
        network: 'TRON',
      });

      expect(result.passed).toBe(false);
      expect(http.get).toHaveBeenCalledTimes(2);
    });
  });
});
