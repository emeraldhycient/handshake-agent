import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CLOCK, type Clock } from '../../../core/common/clock';
import type { Env } from '../../../core/config/env.schema';
import {
  PROVIDER_PROBE,
  type IProviderProbe,
} from '../application/ports/provider-probe.port';
import type {
  IProviderConnectivity,
  ProviderConnectivity,
} from '../application/ports/provider-connectivity.port';
import {
  PROVIDER_PROBE_SPECS,
  resolveProbePosture,
  type ProbeSpec,
} from '../application/provider-probe-registry';

/**
 * Cached provider-connectivity adapter for the system-health card. Runs a real,
 * CREDENTIAL-FREE liveness probe (via PROVIDER_PROBE) against each provider's public
 * host and caches the whole snapshot for a short TTL, refreshed at most once per
 * window (single-flight). A synchronous per-request probe is deliberately avoided:
 * reads inside the TTL are served from memory. Read-only, moves no money (§3.1); no
 * secret VALUE crosses the boundary — only the base URL reaches the probe (§3.4/§3.5).
 * Singleton scope so the cache persists across requests. Never throws (the probe port
 * never throws).
 *
 * SNAPSHOT_TTL_MS is a documented internal constant, consistent with the existing
 * hardcoded PROBE_TIMEOUT_MS / DEGRADED_LATENCY_MS in the probe adapter.
 */
const SNAPSHOT_TTL_MS = 45_000;

@Injectable()
export class CachedProviderConnectivityAdapter implements IProviderConnectivity {
  private snapshot: Map<string, ProviderConnectivity> | null = null;
  private snapshotAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(PROVIDER_PROBE) private readonly probe: IProviderProbe,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async statusFor(key: string): Promise<ProviderConnectivity | null> {
    await this.ensureFresh();
    return this.snapshot?.get(key) ?? null;
  }

  /** Refresh the snapshot if stale/cold; concurrent callers await one in-flight run. */
  private async ensureFresh(): Promise<void> {
    const isFresh =
      this.snapshot !== null &&
      this.clock.now().getTime() - this.snapshotAt < SNAPSHOT_TTL_MS;
    if (isFresh) return;

    if (this.inflight !== null) {
      await this.inflight;
      return;
    }
    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }

  private async refresh(): Promise<void> {
    const entries = await Promise.all(
      PROVIDER_PROBE_SPECS.map(
        async (spec) => [spec.key, await this.probeOne(spec)] as const,
      ),
    );
    this.snapshot = new Map(entries);
    this.snapshotAt = this.clock.now().getTime();
  }

  private async probeOne(spec: ProbeSpec): Promise<ProviderConnectivity> {
    const posture = resolveProbePosture(spec, (k) =>
      this.config.get(k, { infer: true }),
    );
    if (posture.kind !== 'probe') {
      // mock / not_configured → no live signal; caller keeps its placeholder.
      return { status: 'ok', latencyMs: null, observed: false };
    }
    const outcome = await this.probe.probe(posture.baseUrl);
    return {
      status: outcome.reachability,
      latencyMs: outcome.reachability === 'down' ? null : outcome.latencyMs,
      observed: true,
    };
  }
}
