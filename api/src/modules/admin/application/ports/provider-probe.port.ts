/**
 * DI token + port for the provider LIVENESS PROBE (Phase 7 — "Test connection").
 *
 * A liveness probe is a real, NON-MUTATING reachability check against a provider's
 * public API base host. It carries NO credential (so a secret VALUE never leaves the
 * boundary, §3.4/§3.5) and moves NO money (§3.1) — it only reports whether the host
 * responded and how long it took. The concrete adapter (HttpService-backed) lives in
 * `admin/infrastructure`; the application layer depends only on this abstraction
 * (clean-arch §4.1). Unknown/unreachable hosts resolve to `down`, never throw.
 */
export const PROVIDER_PROBE = Symbol('PROVIDER_PROBE');

/** The reachability outcome of a single liveness probe. */
export type ProviderReachability = 'ok' | 'degraded' | 'down';

/** The result of a liveness round-trip: reachability + observed latency (ms). */
export interface ProviderProbeOutcome {
  reachability: ProviderReachability;
  latencyMs: number;
}

export interface IProviderProbe {
  /**
   * Perform a bounded, credential-free reachability check against `baseUrl` and
   * return the outcome. NEVER throws — an unreachable host / timeout resolves to a
   * `down` outcome. NEVER sends a secret. Measures the observed round-trip latency.
   */
  probe(baseUrl: string): Promise<ProviderProbeOutcome>;
}
