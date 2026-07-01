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

/**
 * ADM Phase 7 (WRITE-adjacent — an execute-gated action) — the "Test connection"
 * liveness probe for a provider adapter. It performs a real, NON-MUTATING
 * reachability check against the provider's public API base host and reports
 * reachability + latency. It NEVER returns a secret VALUE (§3.4/§3.5) — the probe is
 * credential-free (only the base URL crosses to the probe port) — and NEVER moves
 * money (§3.1).
 *
 * Posture gates the probe (fail-closed):
 *   • mock mode on            → `mock` (no probe attempted; a no-op success).
 *   • required secret absent  → `not_configured` (we do NOT probe with no credential).
 *   • no known probe base URL → `not_configured` (cannot probe a host we don't know).
 *   • otherwise               → a real reachability probe (ok / degraded / down).
 * An unknown provider key fails closed with a NotFound (mapped to 404).
 *
 * It holds no Prisma import — it reaches config via ConfigService and the network via
 * the injected PROVIDER_PROBE port only (§3.2).
 */

/** How to resolve one provider's probe posture from the layered env. */
interface ProbeSpec {
  key: string;
  /** The env key whose presence marks the provider's secret as configured. */
  secretKey: keyof Env;
  /** The `*_MOCK_MODE` env key gating this adapter, or null if it has none. */
  mockModeKey: keyof Env | null;
  /** The env key holding the provider's public API base URL, or null if none. */
  baseUrlKey: keyof Env | null;
}

/**
 * The probeable-provider registry — mirrors AdminProvidersService's PROVIDER_SPECS.
 * Only Blockradar + Flutterwave expose a credential-free base host we can safely
 * reach; the messaging/LLM adapters have no such probe surface, so they resolve to
 * `not_configured` for the liveness probe (never a fabricated result, §3.6).
 */
const PROBE_SPECS: readonly ProbeSpec[] = [
  {
    key: 'blockradar',
    secretKey: 'BLOCKRADAR_API_KEY',
    mockModeKey: 'WALLET_MOCK_MODE',
    baseUrlKey: 'BLOCKRADAR_BASE_URL',
  },
  {
    key: 'flutterwave',
    secretKey: 'FLUTTERWAVE_SECRET_KEY',
    mockModeKey: 'PAYMENTS_MOCK_MODE',
    baseUrlKey: 'FLUTTERWAVE_BASE_URL',
  },
  {
    key: 'resend',
    secretKey: 'RESEND_API_KEY',
    mockModeKey: null,
    baseUrlKey: null,
  },
  {
    key: 'whatsapp',
    secretKey: 'WHATSAPP_ACCESS_TOKEN',
    mockModeKey: null,
    baseUrlKey: null,
  },
  {
    key: 'anthropic',
    secretKey: 'ANTHROPIC_API_KEY',
    mockModeKey: null,
    baseUrlKey: null,
  },
];

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
    const spec = PROBE_SPECS.find((s) => s.key === key);
    if (spec === undefined) throw new AdminNotFoundError('Provider');

    const checkedAt = new Date().toISOString();

    // Mock mode → a no-op success (the adapter is deliberately not live).
    if (spec.mockModeKey !== null && this.isMock(spec.mockModeKey)) {
      return { key, result: 'mock', latencyMs: null, checkedAt };
    }

    // No credential or no known probe host → not_configured (fail-closed; we never
    // probe with an empty secret, and never fabricate a result for an unknown host).
    const hasSecret = Boolean(this.config.get(spec.secretKey, { infer: true }));
    const baseUrlValue =
      spec.baseUrlKey !== null
        ? this.config.get(spec.baseUrlKey, { infer: true })
        : undefined;
    // config.get infers `string | number`; coerce to string (no cast — eslint's
    // no-unnecessary-type-assertion mis-fixes an `as string` here).
    const baseUrl =
      baseUrlValue === undefined ? undefined : String(baseUrlValue);
    if (!hasSecret || baseUrl === undefined || baseUrl.length === 0) {
      return { key, result: 'not_configured', latencyMs: null, checkedAt };
    }

    // A real, credential-free reachability probe against the base host.
    const outcome = await this.probe.probe(baseUrl);
    const result = RESULT_BY_REACHABILITY[outcome.reachability];
    // A `down` outcome carries no meaningful latency — surface null so the FE shows
    // the status word alone (colour is never the sole signal).
    const latencyMs =
      outcome.reachability === 'down' ? null : outcome.latencyMs;
    return { key, result, latencyMs, checkedAt };
  }

  /** True iff the given `*_MOCK_MODE` env flag is the literal 'true'. */
  private isMock(key: keyof Env): boolean {
    return this.config.get(key, { infer: true }) === 'true';
  }
}
