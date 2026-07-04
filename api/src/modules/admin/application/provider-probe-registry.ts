import type { Env } from '../../../core/config/env.schema';

/**
 * Shared PROVIDER LIVENESS-PROBE registry (Phase 7 "Test connection" + the Phase-6b
 * system-health card). Each entry names the env keys that resolve a provider's probe
 * posture: the secret whose presence marks it configured, the `*_MOCK_MODE` gate (or
 * null), and the public API base host to reach credential-free. NO secret VALUE ever
 * leaves via this module — only the base URL is surfaced (§3.4/§3.5). Pure data + a
 * pure resolver, so both the on-demand probe service and the cached connectivity
 * adapter derive posture identically (DRY §13.2).
 */
export interface ProbeSpec {
  key: string;
  /** Env key whose presence marks the provider's secret as configured. */
  secretKey: keyof Env;
  /** `*_MOCK_MODE` env key gating this adapter, or null if it has none. */
  mockModeKey: keyof Env | null;
  /** Env key holding the provider's public API base host. */
  baseUrlKey: keyof Env | null;
}

export const PROVIDER_PROBE_SPECS: readonly ProbeSpec[] = [
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
    baseUrlKey: 'RESEND_BASE_URL',
  },
  {
    key: 'whatsapp',
    secretKey: 'WHATSAPP_ACCESS_TOKEN',
    mockModeKey: null,
    baseUrlKey: 'WHATSAPP_GRAPH_BASE_URL',
  },
  {
    key: 'anthropic',
    secretKey: 'ANTHROPIC_API_KEY',
    mockModeKey: null,
    baseUrlKey: 'ANTHROPIC_BASE_URL',
  },
];

/**
 * Reads a config value by env key. Loose value type — the resolver only needs
 * presence + string coercion, and this keeps callers free of ConfigService generics.
 */
export type ProbeConfigReader = (key: keyof Env) => string | number | undefined;

/** The resolved probe posture for one provider. */
export type ProbePosture =
  | { kind: 'mock' }
  | { kind: 'not_configured' }
  | { kind: 'probe'; baseUrl: string };

/**
 * Fail-closed posture resolution (identical rules for both consumers):
 *   mock-mode 'true'              → mock (no probe attempted)
 *   secret absent OR no base URL  → not_configured (never probe with no host)
 *   otherwise                     → probe against the resolved base host.
 */
export function resolveProbePosture(
  spec: ProbeSpec,
  read: ProbeConfigReader,
): ProbePosture {
  if (spec.mockModeKey !== null && read(spec.mockModeKey) === 'true') {
    return { kind: 'mock' };
  }
  const hasSecret = Boolean(read(spec.secretKey));
  const rawBaseUrl =
    spec.baseUrlKey !== null ? read(spec.baseUrlKey) : undefined;
  const baseUrl = rawBaseUrl === undefined ? undefined : String(rawBaseUrl);
  if (!hasSecret || baseUrl === undefined || baseUrl.length === 0) {
    return { kind: 'not_configured' };
  }
  return { kind: 'probe', baseUrl };
}
