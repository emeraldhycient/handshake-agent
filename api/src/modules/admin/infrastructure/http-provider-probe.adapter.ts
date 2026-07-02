import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import type {
  IProviderProbe,
  ProviderProbeOutcome,
} from '../application/ports/provider-probe.port';

/**
 * HttpService-backed liveness probe (Phase 7). Performs a bounded, CREDENTIAL-FREE
 * GET against a provider's public API base host and reports reachability + latency.
 *
 * FUNDS-SAFETY / SECRETS: no auth header is ever attached — the probe checks that the
 * host is reachable, not that our key is valid, so no secret VALUE leaves the process
 * (§3.4/§3.5). It is read-only and moves no money (§3.1).
 *
 * A reachable host (any HTTP status, including 401/404 — the host answered) is `ok`;
 * a slow response is `degraded`; a timeout / connection error is `down`. The probe
 * NEVER throws — a network failure resolves to a `down` outcome.
 */

/** Bounded probe timeout (ms) — a liveness check must not hang the request. */
const PROBE_TIMEOUT_MS = 4000;
/** Above this observed latency the host is reachable but `degraded`. */
const DEGRADED_LATENCY_MS = 1500;

@Injectable()
export class HttpProviderProbeAdapter implements IProviderProbe {
  constructor(private readonly http: HttpService) {}

  async probe(baseUrl: string): Promise<ProviderProbeOutcome> {
    const start = Date.now();
    try {
      // No Authorization header — a reachability check only. `validateStatus` accepts
      // any status: an answered 401/404 still proves the host is reachable.
      await firstValueFrom(
        this.http.get(baseUrl, {
          timeout: PROBE_TIMEOUT_MS,
          validateStatus: () => true,
        }),
      );
      const latencyMs = Date.now() - start;
      return {
        reachability: latencyMs > DEGRADED_LATENCY_MS ? 'degraded' : 'ok',
        latencyMs,
      };
    } catch {
      // Timeout / DNS / connection refused → the host is unreachable.
      return { reachability: 'down', latencyMs: Date.now() - start };
    }
  }
}
