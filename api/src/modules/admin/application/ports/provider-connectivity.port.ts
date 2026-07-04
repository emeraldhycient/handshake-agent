/**
 * DI token + port for CACHED PROVIDER CONNECTIVITY — a short-TTL liveness view used
 * by the operator system-health card. It reports each provider's most-recent
 * reachability + latency from a cached snapshot (never a synchronous per-request
 * probe). Read-only, credential-free (§3.1/§3.4/§3.5). The concrete cache/probe
 * adapter lives in `admin/infrastructure`; the metrics-ops read repository depends
 * only on this abstraction.
 */
export const PROVIDER_CONNECTIVITY = Symbol('PROVIDER_CONNECTIVITY');

/** A provider's cached liveness signal. */
export interface ProviderConnectivity {
  status: 'ok' | 'degraded' | 'down';
  /** Observed round-trip latency (ms); null for `down` or when unobserved. */
  latencyMs: number | null;
  /**
   * true  → a real observed probe result (use status + latency).
   * false → mock / not-configured / no host — NOT a live signal; the caller should
   *         keep its own placeholder rather than surface a fabricated status.
   */
  observed: boolean;
}

export interface IProviderConnectivity {
  /**
   * Cached liveness for a provider key (short TTL, single-flight refresh). Returns
   * null when the key is unknown to the probe registry. NEVER throws.
   */
  statusFor(key: string): Promise<ProviderConnectivity | null>;
}
