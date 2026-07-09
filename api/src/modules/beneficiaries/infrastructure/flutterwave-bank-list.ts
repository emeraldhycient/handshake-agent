import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import type { Bank } from '@handshake-agent/contracts';

import type { IBankListProvider } from '../application/ports/bank-list.port';

// ---------------------------------------------------------------------------
// Flutterwave v3 GET /banks/{country} response shape
// ---------------------------------------------------------------------------

interface FlutterwaveBank {
  id: number;
  code: string;
  name: string;
}

interface ListBanksResponse {
  status: string;
  message: string;
  data: FlutterwaveBank[] | null;
}

/** Per-country cache entry: the mapped banks + when they were fetched. */
interface CacheEntry {
  banks: Bank[];
  fetchedAt: number;
}

/**
 * Real bank-list adapter using Flutterwave's v3 `GET /banks/{country}` endpoint.
 *
 * Implements `IBankListProvider` and is activated when `NAME_ENQUIRY_MOCK_MODE`
 * is not `'true'` (the module factory selects this or MockBankList at boot,
 * gated exactly like the name-enquiry port). Auth + config keys mirror
 * FlutterwaveNameEnquiry (`FLUTTERWAVE_BASE_URL`, `FLUTTERWAVE_SECRET_KEY`).
 *
 * Banks are near-static, so results are cached per-country for
 * `CACHE_TTL_MS` (24h) with a per-country single-flight (concurrent first calls
 * share one HTTP request — mirrors the provider-probe cache pattern).
 *
 * Resilience (port contract): this backs a dropdown, not the money path, so a
 * provider/HTTP failure returns `[]` (logged at warn) rather than throwing — the
 * client falls back to its offline bank list. Failures are NOT cached, so the
 * next request retries.
 */
@Injectable()
export class FlutterwaveBankList implements IBankListProvider {
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  private readonly logger = new Logger(FlutterwaveBankList.name);
  private readonly baseUrl: string;
  private readonly authHeader: string;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Bank[]>>();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl =
      this.config.get<string>('FLUTTERWAVE_BASE_URL') ??
      'https://api.flutterwave.com/v3';
    const secretKey = this.config.get<string>('FLUTTERWAVE_SECRET_KEY') ?? '';
    this.authHeader = `Bearer ${secretKey}`;
  }

  async listBanks(country: string): Promise<Bank[]> {
    const code = country.trim().toUpperCase();

    // 1. Serve a fresh cache hit.
    const cached = this.cache.get(code);
    if (
      cached &&
      Date.now() - cached.fetchedAt < FlutterwaveBankList.CACHE_TTL_MS
    ) {
      return cached.banks;
    }

    // 2. Join an in-flight fetch for the same country (single-flight).
    const existing = this.inflight.get(code);
    if (existing) return existing;

    const fetchPromise = this.fetchAndCache(code).finally(() => {
      this.inflight.delete(code);
    });
    this.inflight.set(code, fetchPromise);
    return fetchPromise;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchAndCache(country: string): Promise<Bank[]> {
    const url = `${this.baseUrl}/banks/${country}`;

    try {
      const response = await firstValueFrom(
        this.http.get<ListBanksResponse>(url, { headers: this.headers() }),
      );

      const resp = response.data;
      if (resp.status !== 'success' || !Array.isArray(resp.data)) {
        // Non-success body (e.g. unknown country) → degrade to empty, do not cache.
        this.logger.warn(
          { country, message: resp.message },
          'Flutterwave /banks returned a non-success body',
        );
        return [];
      }

      const banks: Bank[] = resp.data.map((b) => ({
        name: b.name,
        code: b.code,
      }));
      this.cache.set(country, { banks, fetchedAt: Date.now() });
      return banks;
    } catch (err: unknown) {
      // Dropdown backing, not money path: never throw. Log + degrade to empty;
      // the failure is NOT cached so the next request retries.
      this.logger.warn(
        { country, err: err instanceof Error ? err.message : String(err) },
        'Flutterwave /banks request failed — returning empty list',
      );
      return [];
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };
  }
}
