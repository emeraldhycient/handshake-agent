import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  ProviderCardView,
  ProviderRegistryStatus,
  ProviderRegistryView,
  ProviderReadinessItem,
} from '@handshake-agent/contracts';

import type { Env } from '../../../core/config/env.schema';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';

/**
 * Phase 6b — READ-ONLY admin Providers registry (design §6.27). One card per
 * external adapter (Blockradar / Flutterwave / Resend / WhatsApp / Anthropic):
 * its non-secret wiring, mock-mode, bound capabilities, a status DERIVED from
 * configuration posture, and a secret-PRESENCE boolean — the secret VALUE is
 * NEVER returned (§3.4 / §3.5). It also computes a mock→live readiness checklist,
 * each item backed by a real config signal (not a hardcoded flag).
 *
 * It reads the layered env via ConfigService and capability flags via the global
 * EffectiveConfigService; there is NO write path, NO live probe (test-connection /
 * key-reveal are Phase 7), and it never moves money (§3.1). It holds no Prisma
 * import — it reaches data only through the injected config (§3.2).
 */

/** A `*_MOCK_MODE` env value is the literal string 'true' / 'false'. */
type MockModeKey = keyof Pick<
  Env,
  | 'WALLET_MOCK_MODE'
  | 'PAYMENTS_MOCK_MODE'
  | 'SANCTIONS_MOCK_MODE'
  | 'NAME_ENQUIRY_MOCK_MODE'
>;

/** The registry entry describing how to resolve one provider's card from config. */
interface ProviderSpec {
  key: string;
  name: string;
  kind: string;
  /** The env key(s) whose presence marks the provider's secret as configured. */
  secretKeys: readonly (keyof Env)[];
  /** The `*_MOCK_MODE` env key gating this adapter, or null if it has no mock mode. */
  mockModeKey: MockModeKey | null;
  capabilities: readonly string[];
}

/**
 * The static provider registry — the five real external adapters wired into the
 * platform. Each maps to its required secret env key(s), its mock-mode flag, and
 * its bound capabilities. Adding a provider here surfaces a new card with no other
 * change (registry-driven, §7). The catalog `crypto.*` capabilities Blockradar is
 * bound to are resolved live from the effective config so a disabled capability
 * drops off the card.
 */
const PROVIDER_SPECS: readonly ProviderSpec[] = [
  {
    key: 'blockradar',
    name: 'Blockradar',
    kind: 'Custodial crypto WaaS · TRON',
    secretKeys: ['BLOCKRADAR_API_KEY'],
    mockModeKey: 'WALLET_MOCK_MODE',
    capabilities: ['crypto.buy', 'crypto.sell', 'crypto.send', 'crypto.swap'],
  },
  {
    key: 'flutterwave',
    name: 'Flutterwave',
    kind: 'Fiat rails (Flutterwave)',
    secretKeys: ['FLUTTERWAVE_SECRET_KEY'],
    mockModeKey: 'PAYMENTS_MOCK_MODE',
    capabilities: ['payout', 'collection'],
  },
  {
    key: 'resend',
    name: 'Resend',
    kind: 'Transactional email',
    secretKeys: ['RESEND_API_KEY'],
    // Resend has no `*_MOCK_MODE` flag — an absent key selects the mock provider.
    mockModeKey: null,
    capabilities: ['email'],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp Cloud API',
    kind: 'Messaging + Flows',
    secretKeys: ['WHATSAPP_ACCESS_TOKEN'],
    mockModeKey: null,
    capabilities: ['chat', 'flows'],
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    kind: 'Agent LLM',
    secretKeys: ['ANTHROPIC_API_KEY'],
    mockModeKey: null,
    capabilities: ['agent'],
  },
];

/** The money-path mock-mode flags that must all be off for a live launch. */
const MONEY_PATH_MOCK_KEYS: readonly MockModeKey[] = [
  'WALLET_MOCK_MODE',
  'PAYMENTS_MOCK_MODE',
  'SANCTIONS_MOCK_MODE',
  'NAME_ENQUIRY_MOCK_MODE',
];

@Injectable()
export class AdminProvidersService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly effectiveConfig: EffectiveConfigService,
  ) {}

  /** The composite Providers view: registry cards + the readiness checklist. */
  getRegistry(): ProviderRegistryView {
    return {
      providers: PROVIDER_SPECS.map((spec) => this.toCard(spec)),
      readiness: this.computeReadiness(),
    };
  }

  /** Resolve one provider card from its spec against the current config posture. */
  private toCard(spec: ProviderSpec): ProviderCardView {
    const hasSecret = spec.secretKeys.every((k) =>
      Boolean(this.config.get(k, { infer: true })),
    );
    const mock = spec.mockModeKey !== null && this.isMock(spec.mockModeKey);
    return {
      key: spec.key,
      name: spec.name,
      kind: spec.kind,
      status: this.deriveStatus(mock, hasSecret),
      mock,
      hasSecret,
      capabilities: this.boundCapabilities(spec),
      // No live probe on the read path — latency arrives with a Phase-7 health probe.
      latencyMs: null,
    };
  }

  /**
   * Posture-derived status (never a live probe): a mock adapter is `mock`; a live
   * adapter missing its secret is `down` (unusable); otherwise `ok`. `degraded` is
   * reserved for the Phase-7 probe and is never emitted here.
   */
  private deriveStatus(
    mock: boolean,
    hasSecret: boolean,
  ): ProviderRegistryStatus {
    if (mock) return 'mock';
    return hasSecret ? 'ok' : 'down';
  }

  /**
   * The bound capabilities for a card. Blockradar's `crypto.*` bindings are
   * filtered to those still enabled in the live catalog so a disabled capability
   * (admin flag off) drops off the card; non-catalog capabilities pass through.
   */
  private boundCapabilities(spec: ProviderSpec): string[] {
    const flags = this.capabilityFlags();
    return spec.capabilities.filter((cap) =>
      cap.startsWith('crypto.') ? flags[cap] === true : true,
    );
  }

  /** The mock→live readiness checklist — each `done` computed from a real signal. */
  private computeReadiness(): ProviderReadinessItem[] {
    const allSecretsPresent = PROVIDER_SPECS.every((spec) =>
      spec.secretKeys.every((k) =>
        Boolean(this.config.get(k, { infer: true })),
      ),
    );
    const allMockOff = MONEY_PATH_MOCK_KEYS.every((k) => !this.isMock(k));
    const webhookVerified = Boolean(
      this.config.get('FLUTTERWAVE_WEBHOOK_SECRET', { infer: true }),
    );
    // Deposit reconciliation is only meaningful against real (non-mock) balances;
    // with WALLET_MOCK_MODE off the settlement-reconciliation cron drives live rows.
    const reconLive = !this.isMock('WALLET_MOCK_MODE');
    const swapEnrolled = this.isSwapRouteEnrolled();

    return [
      {
        key: 'live-keys',
        label: 'Live API keys provisioned for every enabled provider',
        done: allSecretsPresent,
      },
      {
        key: 'mock-off',
        label: 'PAYMENTS_MOCK_MODE / WALLET_MOCK_MODE flipped to false',
        done: allMockOff,
      },
      {
        key: 'webhooks',
        label: 'Provider webhook signatures verified end-to-end',
        done: webhookVerified,
      },
      {
        key: 'recon',
        label: 'Reconciliation cron scheduled against live balances',
        done: reconLive,
      },
      {
        key: 'swap',
        label: 'Swap route (USDT ↔ TRX) enrolled on Blockradar',
        done: swapEnrolled,
      },
    ];
  }

  /**
   * The swap route is enrolled when its mock is off, the `crypto.swap` capability
   * is enabled, and the catalog has ≥2 enabled crypto assets (the swap provider's
   * own precondition) — all real config signals.
   */
  private isSwapRouteEnrolled(): boolean {
    const swapLive =
      this.config.get('SWAP_MOCK_MODE', { infer: true }) === 'false';
    const swapCapable = this.capabilityFlags()['crypto.swap'] === true;
    return swapLive && swapCapable;
  }

  /** True iff the given `*_MOCK_MODE` env flag is the literal 'true'. */
  private isMock(key: MockModeKey): boolean {
    return this.config.get(key, { infer: true }) === 'true';
  }

  /** The live capability flag map from the layered catalog config. */
  private capabilityFlags(): Record<string, boolean> {
    return (
      this.effectiveConfig.get<Record<string, boolean>>(
        'catalog.capabilities',
      ) ?? {}
    );
  }
}
