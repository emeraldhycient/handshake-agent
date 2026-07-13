import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import type { KycTierLevel } from '@handshake-agent/contracts';

import { hmacHex } from '../../../core/crypto/hmac';
import type { Env } from '../../../core/config/env.schema';
import type {
  CreateVerificationSessionInput,
  CreateVerificationSessionResult,
  IKycProvider,
  KycVerifyInput,
  KycVerifyResult,
} from '../application/ports/kyc-provider.port';

// ---------------------------------------------------------------------------
// Sumsub HMAC request signing — pure helpers (task 3.3)
//
// Sumsub authenticates server-to-server calls with three headers:
//   X-App-Token:      the app-level API token (SUMSUB_API_TOKEN)
//   X-App-Access-Ts:  unix seconds the request was signed at
//   X-App-Access-Sig: hex HMAC-SHA256(SUMSUB_API_SECRET_KEY, ts + METHOD + path+query + body)
//
// `buildSumsubSignature` / `buildSumsubAuthHeaders` are PURE — they take `ts`
// as a parameter rather than calling Date.now() themselves — so a unit test
// can pin them against a known vector. The adapter is the only caller that
// supplies a real clock reading (Math.floor(Date.now() / 1000)).
// ---------------------------------------------------------------------------

export interface SumsubSignatureInput {
  /** Unix seconds. Passed in, never read from the clock here (pure function). */
  ts: number;
  /** Uppercase HTTP method, e.g. 'POST'. */
  method: string;
  /** Request path including the query string, e.g. '/resources/accessTokens?userId=...'. */
  pathWithQuery: string;
  /** Exact request body as sent over the wire (empty string when there is none). */
  body: string;
  secretKey: string;
}

export interface SumsubAuthHeadersInput extends SumsubSignatureInput {
  appToken: string;
}

/**
 * Computes the hex HMAC-SHA256 signature Sumsub expects in X-App-Access-Sig.
 * Reuses the shared `hmacHex` primitive (core/crypto/hmac.ts) rather than
 * re-implementing Node's `crypto.createHmac` — the same primitive verifies
 * the Blockradar/WhatsApp webhook signatures elsewhere in the codebase.
 */
export function buildSumsubSignature(input: SumsubSignatureInput): string {
  const signable = `${input.ts}${input.method}${input.pathWithQuery}${input.body}`;
  return hmacHex('sha256', input.secretKey, signable);
}

/** Builds the full Sumsub auth header set for a single outgoing request. */
export function buildSumsubAuthHeaders(
  input: SumsubAuthHeadersInput,
): Record<string, string> {
  return {
    'X-App-Token': input.appToken,
    'X-App-Access-Ts': String(input.ts),
    'X-App-Access-Sig': buildSumsubSignature(input),
  };
}

// ---------------------------------------------------------------------------
// Sumsub response shapes
// ---------------------------------------------------------------------------

/** POST /resources/accessTokens — Sumsub echoes the externalUserId back as `userId`. */
interface SumsubAccessTokenResponse {
  token: string;
  userId?: string;
}

interface SumsubErrorBody {
  description?: string;
  code?: number;
  errorCode?: number;
}

// ---------------------------------------------------------------------------
// SumsubKycProvider
// ---------------------------------------------------------------------------

/**
 * Real Sumsub adapter — implements `IKycProvider`.
 *
 * `createVerificationSession` mints a short-lived Sumsub WebSDK access token
 * (task 3.3): `POST {SUMSUB_BASE_URL}/resources/accessTokens?userId=<userId>&levelName=<mappedLevelName>`,
 * HMAC-signed per Sumsub's server-to-server auth scheme (see the helpers
 * above). `level` ('tier_2'/'tier_3') is OUR tier — the adapter maps it to the
 * Sumsub dashboard LEVEL NAME configured via SUMSUB_LEVEL_TIER2/TIER3 before
 * sending it as `levelName`; Sumsub has no concept of our tier strings.
 *
 * Mirrors the `FlutterwaveProvider` / `BlockradarProvider` pattern: config
 * read once in the constructor via `ConfigService<Env, true>` (never raw
 * `process.env` — Task 3.2 follow-up note), HTTP via the injected
 * `HttpService` (mockable in tests, no real network access), and errors
 * wrapped into a descriptive `Error` carrying a structural `httpStatus` so
 * callers can distinguish a definitive 4xx rejection from an ambiguous
 * network/5xx failure.
 *
 * `verify()` (the legacy synchronous NIN/BVN path used by /kyc/submit and
 * /kyc/complete for tier_1 onboarding) is intentionally NOT implemented
 * against the real Sumsub API — Sumsub has no equivalent synchronous
 * NIN/BVN check; its real flow is applicant-creation + document upload +
 * webhook review. Faking an approval/rejection here would be a security bug
 * (root CLAUDE.md §3.6), so it fails closed (throws) instead.
 * TODO(KYC-TIER1-SUMSUB): decide + implement the tier_1 path once
 * KYC_MOCK_MODE=false ships to production — out of scope for task 3.3.
 */
@Injectable()
export class SumsubKycProvider implements IKycProvider {
  private readonly baseUrl: string;
  private readonly appToken: string;
  private readonly secretKey: string;
  private readonly levelNameByTier: Record<KycTierLevel, string>;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.baseUrl = this.config.get<'SUMSUB_BASE_URL'>('SUMSUB_BASE_URL');
    this.appToken = this.config.get<'SUMSUB_API_TOKEN'>('SUMSUB_API_TOKEN');
    this.secretKey = this.config.get<'SUMSUB_API_SECRET_KEY'>(
      'SUMSUB_API_SECRET_KEY',
    );
    this.levelNameByTier = {
      tier_2: this.config.get<'SUMSUB_LEVEL_TIER2'>('SUMSUB_LEVEL_TIER2'),
      tier_3: this.config.get<'SUMSUB_LEVEL_TIER3'>('SUMSUB_LEVEL_TIER3'),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verify(_input: KycVerifyInput): Promise<KycVerifyResult> {
    return Promise.reject(
      new Error(
        'SumsubKycProvider.verify() is not implemented: the real Sumsub ' +
          'provider only supports the async createVerificationSession ' +
          '(WebSDK) flow for tier_2/tier_3 upgrades. TODO(KYC-TIER1-SUMSUB): ' +
          'the tier_1 NIN/BVN legacy path needs a dedicated design decision ' +
          'before KYC_MOCK_MODE=false can serve /kyc/submit or /kyc/complete ' +
          'in production.',
      ),
    );
  }

  async createVerificationSession(
    input: CreateVerificationSessionInput,
  ): Promise<CreateVerificationSessionResult> {
    const levelName = this.levelNameByTier[input.level];
    if (!levelName) {
      throw new Error(
        `Sumsub misconfiguration: no level name configured for tier ` +
          `'${input.level}' (expected env SUMSUB_LEVEL_TIER${
            input.level === 'tier_2' ? '2' : '3'
          } to be set).`,
      );
    }

    const path = '/resources/accessTokens';
    const query = `?userId=${encodeURIComponent(input.userId)}&levelName=${encodeURIComponent(levelName)}`;
    const pathWithQuery = `${path}${query}`;
    const url = `${this.baseUrl}${pathWithQuery}`;
    const ts = Math.floor(Date.now() / 1000);
    const body = '';

    const headers = {
      ...buildSumsubAuthHeaders({
        ts,
        method: 'POST',
        pathWithQuery,
        body,
        appToken: this.appToken,
        secretKey: this.secretKey,
      }),
      'Content-Type': 'application/json',
    };

    try {
      const response = await firstValueFrom(
        this.http.post<SumsubAccessTokenResponse>(url, undefined, {
          headers,
        }),
      );

      return {
        token: response.data.token,
        applicantId: response.data.userId ?? input.userId,
      };
    } catch (err: unknown) {
      throw this.wrapError('createVerificationSession', err);
    }
  }

  /**
   * Translates an Axios rejection into a descriptive Error. Mirrors
   * FlutterwaveProvider.wrapError / BlockradarProvider's equivalent: the HTTP
   * status is preserved STRUCTURALLY (`httpStatus` property) so callers can
   * distinguish a definitive 4xx rejection from an ambiguous network/5xx
   * failure. Network errors (no axios `response`) leave `httpStatus`
   * undefined — ambiguous.
   */
  private wrapError(operation: string, err: unknown): Error {
    const axiosErr = err as AxiosError<SumsubErrorBody>;
    const body = axiosErr?.response?.data;
    const httpStatus = axiosErr?.response?.status;
    if (body?.description) {
      const wrapped = new Error(
        `Sumsub ${operation} error (HTTP ${httpStatus ?? 'unknown'}): ${body.description}`,
      );
      if (httpStatus !== undefined) {
        Object.assign(wrapped, { httpStatus });
      }
      return wrapped;
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
