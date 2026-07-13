/**
 * Unit tests for SumsubKycProvider (task 3.3).
 *
 * Three concerns, tested independently:
 *  (a) the pure signing helper — `buildSumsubAuthHeaders` — produces the exact
 *      X-App-Token / X-App-Access-Ts / X-App-Access-Sig header set for a FIXED
 *      (ts, method, path+query, body) input. The expected signature is a known
 *      HMAC-SHA256 vector computed independently below (not just re-deriving
 *      the implementation), so a regression in the signable-string layout
 *      breaks this test.
 *  (b) `createVerificationSession` — maps our tier ('tier_2'/'tier_3') to the
 *      Sumsub dashboard LEVEL NAME (SUMSUB_LEVEL_TIER2/3) in the outgoing
 *      request URL, and returns { token, applicantId } from the response.
 *  (c) the module's `selectKycProvider` binding resolves KYC_PROVIDER to the
 *      mock when KYC_MOCK_MODE=true, and to SumsubKycProvider when 'false'.
 *
 * TDD: written before the implementation to drive the design (RED first).
 */
import * as nodeCrypto from 'crypto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';

import {
  buildSumsubAuthHeaders,
  SumsubKycProvider,
} from './sumsub-kyc.provider';
import { MockKycProvider } from './mock-kyc.provider';
import { selectKycProvider } from '../identity.module';
import type { Env } from '../../../core/config/env.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} as never },
  };
}

/** Reference HMAC computed independently (not via the module under test). */
function referenceHmacHex(secret: string, signable: string): string {
  return nodeCrypto.createHmac('sha256', secret).update(signable).digest('hex');
}

function makeConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const env: Partial<Env> = {
    SUMSUB_BASE_URL: 'https://api.sumsub.com',
    SUMSUB_API_TOKEN: 'sbx:test-app-token',
    SUMSUB_API_SECRET_KEY: 'test-secret-key',
    SUMSUB_LEVEL_TIER2: 'basic-kyc-level',
    SUMSUB_LEVEL_TIER3: 'enhanced-kyc-level',
    ...overrides,
  };
  return {
    get: <K extends keyof Env>(key: K) => env[key],
  } as unknown as ConfigService<Env, true>;
}

function makeHttpService(): jest.Mocked<HttpService> {
  return { post: jest.fn() } as unknown as jest.Mocked<HttpService>;
}

// ---------------------------------------------------------------------------
// (a) Pure signing helper — known HMAC vector
// ---------------------------------------------------------------------------

describe('buildSumsubAuthHeaders — pure signing helper', () => {
  it('produces the exact X-App-Token / X-App-Access-Ts / X-App-Access-Sig headers for a fixed input', () => {
    const ts = 1750000000;
    const method = 'POST';
    const pathWithQuery =
      '/resources/accessTokens?userId=user-123&levelName=basic-kyc-level';
    const body = '';
    const secretKey = 'test-secret-key';
    const appToken = 'sbx:test-app-token';

    // Independently-computed vector: HMAC-SHA256(secretKey, `${ts}${method}${pathWithQuery}${body}`)
    const expectedSig = referenceHmacHex(
      secretKey,
      `${ts}${method}${pathWithQuery}${body}`,
    );
    // Hardcoded so a change to the signable-string layout is caught even if
    // referenceHmacHex and the implementation both drift the same way.
    // Computed externally: node -e "require('crypto').createHmac('sha256','test-secret-key').update('1750000000POST/resources/accessTokens?userId=user-123&levelName=basic-kyc-level').digest('hex')"
    expect(expectedSig).toBe(
      '1763e3c32c2224a8631859160ba7c829593470fd52e984d60343f2c538dacd86',
    );

    const headers = buildSumsubAuthHeaders({
      ts,
      method,
      pathWithQuery,
      body,
      appToken,
      secretKey,
    });

    expect(headers).toEqual({
      'X-App-Token': appToken,
      'X-App-Access-Ts': String(ts),
      'X-App-Access-Sig': expectedSig,
    });
  });

  it('does not read the clock — is a pure function of its inputs', () => {
    const input = {
      ts: 42,
      method: 'GET',
      pathWithQuery: '/x',
      body: '',
      appToken: 'a',
      secretKey: 'b',
    };
    const first = buildSumsubAuthHeaders(input);
    const second = buildSumsubAuthHeaders(input);
    expect(first).toEqual(second);
  });

  it('changes the signature when the body changes (same ts/method/path)', () => {
    const base = {
      ts: 1,
      method: 'POST',
      pathWithQuery: '/resources/accessTokens?userId=u&levelName=l',
      appToken: 'a',
      secretKey: 'b',
    };
    const withEmptyBody = buildSumsubAuthHeaders({ ...base, body: '' });
    const withNonEmptyBody = buildSumsubAuthHeaders({
      ...base,
      body: '{"x":1}',
    });
    expect(withEmptyBody['X-App-Access-Sig']).not.toBe(
      withNonEmptyBody['X-App-Access-Sig'],
    );
  });
});

// ---------------------------------------------------------------------------
// (b) createVerificationSession — tier→levelName mapping + request shape
// ---------------------------------------------------------------------------

describe('SumsubKycProvider — createVerificationSession', () => {
  let http: jest.Mocked<HttpService>;

  beforeEach(() => {
    http = makeHttpService();
  });

  it('maps tier_2 -> SUMSUB_LEVEL_TIER2 in the outgoing request URL and headers', async () => {
    http.post.mockReturnValue(
      of(axiosResponse({ token: 'sumsub-token-abc', userId: 'user-123' })),
    );
    const provider = new SumsubKycProvider(http, makeConfig());

    const result = await provider.createVerificationSession({
      userId: 'user-123',
      level: 'tier_2',
    });

    expect(result).toEqual({
      token: 'sumsub-token-abc',
      applicantId: 'user-123',
    });

    expect(http.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = http.post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];

    expect(url).toBe(
      'https://api.sumsub.com/resources/accessTokens?userId=user-123&levelName=basic-kyc-level',
    );
    expect(body).toBeUndefined();
    expect(config.headers['X-App-Token']).toBe('sbx:test-app-token');
    expect(config.headers['X-App-Access-Ts']).toMatch(/^\d+$/);
    expect(config.headers['X-App-Access-Sig']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('maps tier_3 -> SUMSUB_LEVEL_TIER3 in the outgoing request URL', async () => {
    http.post.mockReturnValue(
      of(axiosResponse({ token: 'sumsub-token-xyz', userId: 'user-456' })),
    );
    const provider = new SumsubKycProvider(http, makeConfig());

    await provider.createVerificationSession({
      userId: 'user-456',
      level: 'tier_3',
    });

    const [url] = http.post.mock.calls[0] as [string];
    expect(url).toBe(
      'https://api.sumsub.com/resources/accessTokens?userId=user-456&levelName=enhanced-kyc-level',
    );
  });

  it('falls back to the input userId as applicantId when the response omits userId', async () => {
    http.post.mockReturnValue(of(axiosResponse({ token: 'tok-no-uid' })));
    const provider = new SumsubKycProvider(http, makeConfig());

    const result = await provider.createVerificationSession({
      userId: 'user-789',
      level: 'tier_2',
    });

    expect(result).toEqual({ token: 'tok-no-uid', applicantId: 'user-789' });
  });

  it('signs the exact request path+query the URL was built from (recomputed independently)', async () => {
    http.post.mockReturnValue(
      of(axiosResponse({ token: 't', userId: 'user-123' })),
    );
    const provider = new SumsubKycProvider(http, makeConfig());

    await provider.createVerificationSession({
      userId: 'user-123',
      level: 'tier_2',
    });

    const [, , config] = http.post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    const ts = config.headers['X-App-Access-Ts'];
    const expectedSig = referenceHmacHex(
      'test-secret-key',
      `${ts}POST/resources/accessTokens?userId=user-123&levelName=basic-kyc-level`,
    );
    expect(config.headers['X-App-Access-Sig']).toBe(expectedSig);
  });

  it('throws a fail-closed error when the configured level name is empty (misconfiguration)', async () => {
    const provider = new SumsubKycProvider(
      http,
      makeConfig({ SUMSUB_LEVEL_TIER2: '' }),
    );

    await expect(
      provider.createVerificationSession({ userId: 'u', level: 'tier_2' }),
    ).rejects.toThrow(/SUMSUB_LEVEL_TIER2/);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('wraps a non-2xx HTTP error with a descriptive message and structural httpStatus', async () => {
    const axiosErr = {
      isAxiosError: true,
      response: {
        status: 401,
        data: { description: 'Invalid X-App-Access-Sig' },
      },
    } as unknown as AxiosError<{ description: string }>;
    http.post.mockReturnValue(throwError(() => axiosErr));
    const provider = new SumsubKycProvider(http, makeConfig());

    await expect(
      provider.createVerificationSession({ userId: 'u', level: 'tier_2' }),
    ).rejects.toThrow(/Sumsub createVerificationSession error/);

    try {
      await provider.createVerificationSession({
        userId: 'u',
        level: 'tier_2',
      });
      fail('expected rejection');
    } catch (err) {
      expect((err as { httpStatus?: number }).httpStatus).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// verify() — legacy sync NIN/BVN path is NOT implemented against real Sumsub
// ---------------------------------------------------------------------------

describe('SumsubKycProvider — verify (legacy NIN/BVN path)', () => {
  it('fails closed (throws) rather than faking an approval/rejection', async () => {
    const provider = new SumsubKycProvider(makeHttpService(), makeConfig());

    await expect(
      provider.verify({ nin: '12345678901', firstName: 'A', lastName: 'B' }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (c) IdentityModule KYC_PROVIDER binding
// ---------------------------------------------------------------------------

describe('IdentityModule — selectKycProvider binding', () => {
  function resolve(kycMockMode: string) {
    // selectKycProvider takes a plain ConfigService (matches selectWalletProvider
    // / selectPaymentProvider convention) — a flat string lookup mirrors
    // wallets-module-binding.spec.ts / treasury-module-binding.spec.ts.
    const env: Record<string, string> = {
      SUMSUB_BASE_URL: 'https://api.sumsub.com',
      SUMSUB_API_TOKEN: 'sbx:test-app-token',
      SUMSUB_API_SECRET_KEY: 'test-secret-key',
      SUMSUB_LEVEL_TIER2: 'basic-kyc-level',
      SUMSUB_LEVEL_TIER3: 'enhanced-kyc-level',
      KYC_MOCK_MODE: kycMockMode,
    };
    const combined = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;

    const mock = new MockKycProvider();
    const real = new SumsubKycProvider(makeHttpService(), makeConfig());
    return selectKycProvider(mock, real, combined);
  }

  it('selects MockKycProvider when KYC_MOCK_MODE=true (default)', () => {
    expect(resolve('true')).toBeInstanceOf(MockKycProvider);
  });

  it('selects MockKycProvider for any non-"false" value (default safe)', () => {
    expect(resolve('')).toBeInstanceOf(MockKycProvider);
  });

  it('selects the real SumsubKycProvider when KYC_MOCK_MODE=false', () => {
    expect(resolve('false')).toBeInstanceOf(SumsubKycProvider);
  });

  it('the selected provider satisfies the port (has verify + createVerificationSession)', () => {
    const real = resolve('false');
    expect(typeof real.verify).toBe('function');
    expect(typeof real.createVerificationSession).toBe('function');
  });
});
