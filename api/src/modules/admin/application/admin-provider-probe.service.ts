import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  ProviderProbeResult,
  ProviderTestResponse,
} from '@handshake-agent/contracts';

import type { Env } from '../../../core/config/env.schema';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  PROVIDER_PROBE,
  type IProviderProbe,
  type ProviderReachability,
} from './ports/provider-probe.port';
import {
  PROVIDER_PROBE_SPECS,
  resolveProbePosture,
} from './provider-probe-registry';

/**
 * ADM Phase 7 (WRITE-adjacent — an execute-gated action) — the "Test connection"
 * liveness probe for a provider adapter. It performs a real, NON-MUTATING
 * reachability check against the provider's public API base host and reports
 * reachability + latency. It NEVER returns a secret VALUE (§3.4/§3.5) — the probe is
 * credential-free (only the base URL crosses to the probe port) — and NEVER moves
 * money (§3.1).
 *
 * Posture (resolved by the shared PROVIDER_PROBE_SPECS registry, fail-closed):
 *   • mock mode on            → `mock` (no probe attempted; a no-op success).
 *   • secret / base URL absent→ `not_configured` (we never probe with no credential
 *                               or against an unknown host).
 *   • otherwise               → a real reachability probe (ok / degraded / down).
 * An unknown provider key fails closed with a NotFound (mapped to 404).
 *
 * It holds no Prisma import — it reaches config via ConfigService and the network via
 * the injected PROVIDER_PROBE port only (§3.2).
 */

/** Reachability outcome → the wire probe-result word. */
const RESULT_BY_REACHABILITY: Record<
  ProviderReachability,
  ProviderProbeResult
> = {
  ok: 'ok',
  degraded: 'degraded',
  down: 'down',
};

@Injectable()
export class AdminProviderProbeService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(PROVIDER_PROBE) private readonly probe: IProviderProbe,
  ) {}

  /** Run a liveness probe for one provider key (fail-closed on unknown key). */
  async test(key: string): Promise<ProviderTestResponse> {
    const spec = PROVIDER_PROBE_SPECS.find((s) => s.key === key);
    if (spec === undefined) throw new AdminNotFoundError('Provider');

    const checkedAt = new Date().toISOString();
    const posture = resolveProbePosture(spec, (k) =>
      this.config.get(k, { infer: true }),
    );

    // Mock mode → a no-op success (the adapter is deliberately not live).
    if (posture.kind === 'mock') {
      return { key, result: 'mock', latencyMs: null, checkedAt };
    }
    // No credential / no known host → not_configured (fail-closed).
    if (posture.kind === 'not_configured') {
      return { key, result: 'not_configured', latencyMs: null, checkedAt };
    }

    // A real, credential-free reachability probe against the base host.
    const outcome = await this.probe.probe(posture.baseUrl);
    const result = RESULT_BY_REACHABILITY[outcome.reachability];
    // A `down` outcome carries no meaningful latency — surface null so the FE shows
    // the status word alone (colour is never the sole signal).
    const latencyMs =
      outcome.reachability === 'down' ? null : outcome.latencyMs;
    return { key, result, latencyMs, checkedAt };
  }
}
