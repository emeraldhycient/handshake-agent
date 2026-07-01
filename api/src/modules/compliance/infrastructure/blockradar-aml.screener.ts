/**
 * BlockradarAmlScreener — real Blockradar AML adapter for ISanctionsScreener.
 *
 * Hits the Blockradar AML lookup endpoint:
 *   GET https://api.blockradar.co/v1/aml/lookup?address=&blockchain=
 *   Auth: x-api-key header (reuses BLOCKRADAR_API_KEY — same key as BlockradarProvider).
 *   Response: { data: { isBlacklisted: boolean }, message: string, statusCode: 200 }
 *
 * Fail-CLOSED: any non-2xx or network/timeout error throws
 * SanctionsScreeningUnavailableError. The send MUST NOT proceed when AML screening
 * cannot confirm the address is clean (root CLAUDE.md §3.1, §3.3).
 *
 * Network → `blockchain` param mapping is config-driven via the `amlBlockchain`
 * field on each CatalogNetwork entry (configuration.ts), making it extensible
 * without code changes.
 *
 * Self-contained in the compliance module — does NOT import from wallets or any
 * other feature module (no compliance→wallets coupling; clean-arch §4.1).
 */

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import type { AxiosError } from 'axios';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { CatalogConfig } from '../../../core/config/configuration';
import { SanctionsScreeningUnavailableError } from '../domain/compliance-errors';
import type {
  ISanctionsScreener,
  SanctionsScreenInput,
  SanctionsScreenResult,
} from '../application/ports/sanctions-screener.port';

// ---------------------------------------------------------------------------
// Blockradar AML response shape (docs.blockradar.co/en/api-reference/aml/lookup)
// ---------------------------------------------------------------------------

interface BlockradarAmlLookupResponse {
  data: {
    isBlacklisted: boolean;
  };
  message: string;
  statusCode: number;
}

// ---------------------------------------------------------------------------
// Screener
// ---------------------------------------------------------------------------

@Injectable()
export class BlockradarAmlScreener implements ISanctionsScreener {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpService,
    // env-only reads (BLOCKRADAR_* flat keys) stay on the plain ConfigService —
    // they are infra/secrets, NOT admin-tunable (root CLAUDE.md §7).
    private readonly config: ConfigService,
    // the `catalog` section IS admin-tunable — read it through EffectiveConfigService
    // so an AppSetting override (e.g. a new network's amlBlockchain) takes effect.
    private readonly effectiveConfig: EffectiveConfigService,
  ) {
    // Read env-level Blockradar config (same values BlockradarProvider uses).
    // BLOCKRADAR_* are flat env keys — not nested under AppConfig.
    this.baseUrl =
      this.config.get<string>('BLOCKRADAR_BASE_URL') ??
      'https://api.blockradar.co/v1';
    this.apiKey = this.config.get<string>('BLOCKRADAR_API_KEY') ?? '';
  }

  async screen(input: SanctionsScreenInput): Promise<SanctionsScreenResult> {
    const { address, network } = input;

    // ── 1. Resolve blockchain param from network catalog ─────────────────────
    const blockchain = this.resolveBlockchain(network);

    // ── 2. Call Blockradar AML lookup (one retry on transient error) ─────────
    const url = `${this.baseUrl}/aml/lookup`;
    let response: BlockradarAmlLookupResponse;

    try {
      response = await this.fetchWithRetry(url, address, blockchain);
    } catch (err: unknown) {
      throw new SanctionsScreeningUnavailableError(
        'blockradar',
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // ── 3. Map response to port result ───────────────────────────────────────
    // Generate a local correlation id — the API returns none in its response.
    const reference = randomUUID();
    const { isBlacklisted } = response.data;

    if (isBlacklisted) {
      return {
        passed: false,
        reason: 'blacklisted address (Blockradar AML)',
        provider: 'blockradar',
        reference,
      };
    }

    return {
      passed: true,
      provider: 'blockradar',
      reference,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves the Blockradar `blockchain` query param from the network id using
   * the catalog config. Config-driven so new networks only need an `amlBlockchain`
   * field in their CatalogNetwork entry (configuration.ts) — no code changes.
   *
   * Throws SanctionsScreeningUnavailableError for unknown/unmapped networks
   * (fail-closed — an unknown network must not silently pass).
   */
  private resolveBlockchain(network: string): string {
    const catalog = this.effectiveConfig.get<CatalogConfig>('catalog');
    const networkMeta = catalog?.networks?.[network];
    const blockchain = networkMeta?.amlBlockchain;

    if (!blockchain) {
      throw new SanctionsScreeningUnavailableError(
        'blockradar',
        new Error(
          `No amlBlockchain mapping configured for network "${network}". ` +
            'Add an amlBlockchain field to the CatalogNetwork entry in configuration.ts.',
        ),
      );
    }

    return blockchain;
  }

  /**
   * Makes the GET request to the AML lookup endpoint with one retry on
   * transient errors (5xx / network timeout). On the second failure the error
   * is re-thrown so the caller can convert it to SanctionsScreeningUnavailableError.
   */
  private async fetchWithRetry(
    url: string,
    address: string,
    blockchain: string,
  ): Promise<BlockradarAmlLookupResponse> {
    const params = { address, blockchain };
    const headers = { 'x-api-key': this.apiKey };

    try {
      const axiosResponse = await firstValueFrom(
        this.http.get<BlockradarAmlLookupResponse>(url, { params, headers }),
      );
      return axiosResponse.data;
    } catch (firstErr: unknown) {
      // Retry once for transient errors (network timeout, 5xx).
      // Do NOT retry 4xx — those are deterministic failures.
      if (this.isTransient(firstErr)) {
        const axiosResponse = await firstValueFrom(
          this.http.get<BlockradarAmlLookupResponse>(url, { params, headers }),
        );
        return axiosResponse.data;
      }
      throw firstErr;
    }
  }

  /**
   * Returns true if the error looks like a transient provider failure
   * (network timeout, connection reset, or a 5xx HTTP response).
   * 4xx errors are deterministic and should not be retried.
   */
  private isTransient(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const axiosErr = err as AxiosError;
    if (!axiosErr.response) {
      // No response → network-level error (timeout, ECONNRESET, etc.).
      return true;
    }
    const status = axiosErr.response.status;
    return status >= 500;
  }
}
