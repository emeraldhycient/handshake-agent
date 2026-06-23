/**
 * JSON-defaults layer of the layered config (root CLAUDE.md §7). These are the
 * committed baseline values; env overrides infra/secrets and the DB-admin layer
 * (not built yet) overrides business-tunable values at runtime.
 *
 * NOTE: `baseRate` here is a placeholder default — production replaces the
 * ConfigRateProvider with a live pricing-feed adapter. `spreadBps` /
 * `processingFeeBps` are genuinely admin-tunable and belong in config.
 */
export interface AssetPricing {
  baseRate: number;
  cryptoDecimals: number;
}

export interface PricingConfig {
  spreadBps: number;
  processingFeeBps: number;
  expiresInSec: number;
  assets: Record<string, AssetPricing>;
}

/** Per-KYC-tier transaction limits (NGN). All values are admin-tunable later. */
export interface TierLimits {
  /** Maximum fiat amount (NGN) per single transaction. */
  perTxFiatMax: number;
  /** Maximum cumulative fiat amount (NGN) within a rolling 24-hour window. */
  dailyFiatMax: number;
  /** Maximum number of transactions within a rolling 24-hour window. */
  dailyTxCountMax: number;
}

/**
 * KYC-tier limit map. `unverified` has no entry — any transaction attempt
 * fails the KYC check before limits are consulted.
 *
 * TODO(config-admin): once the DB-admin AppSetting layer is built, these
 * defaults should be overridable at runtime without a deploy (root CLAUDE.md §7).
 */
export interface LimitsConfig {
  tier_1: TierLimits;
  tier_2: TierLimits;
  tier_3: TierLimits;
}

/** PIN authentication configuration (task 4.3, root CLAUDE.md §7). */
export interface PinConfig {
  /** Maximum consecutive wrong-PIN attempts before the account is locked. */
  maxAttempts: number;
  /** Duration (minutes) for which the account remains locked after maxAttempts failures. */
  lockoutMinutes: number;
  /** Output key length (bytes) for the scrypt KDF. */
  scryptKeyLen: number;
}

export interface AuthConfig {
  pin: PinConfig;
}

/** Directive-grant configuration (task 4.2, ADR-0005/0006). */
export interface DirectiveConfig {
  /**
   * Time-to-live in seconds for a DirectiveGrant. After this window the grant
   * is expired and cannot be consumed. Admin-tunable later (DB-admin layer, §7).
   */
  ttlSeconds: number;
}

/** Buy-execution configuration (task 4.5a, CLAUDE.md §7). */
export interface BuyConfig {
  /**
   * Maximum allowed FX rate drift in basis points between the original quote and
   * the re-quote at execution time. If drift exceeds this, throw QuoteDriftError.
   * Admin-tunable later (DB-admin AppSetting layer, root §7).
   */
  maxDriftBps: number;
}

/** Blockradar provider constants (non-secret, derived from ADR-0006). */
export interface BlockradarProviderConfig {
  /** Asset id for USDT-on-TRON in the Blockradar API. */
  usdtTronAssetId: string;
  /** Network name used when provisioning/querying TRON child addresses. */
  network: string;
}

export interface ProvidersConfig {
  blockradar: BlockradarProviderConfig;
}

// ---------------------------------------------------------------------------
// Catalog — config-driven asset / fiat / network registry (task X1, §7)
// ---------------------------------------------------------------------------

/** Per-provider metadata for a crypto asset (e.g. the Blockradar UUID). */
export interface AssetProviderConfig {
  assetId: string;
}

/**
 * Crypto asset entry in the catalog.
 * BTC is intentionally absent — no Blockradar BTC custody at launch (ADR-0006).
 */
export interface CatalogAsset {
  symbol: string;
  displayName: string;
  kind: 'crypto';
  decimals: number;
  networks: string[];
  providers: Record<string, AssetProviderConfig>;
  enabled: boolean;
}

/** Fiat currency entry in the catalog. */
export interface CatalogFiat {
  code: string;
  displayName: string;
  /** Display symbol, e.g. '₦'. */
  symbol: string;
  decimals: number;
  enabled: boolean;
}

/** Blockchain network entry in the catalog. */
export interface CatalogNetwork {
  id: string;
  displayName: string;
  /** Regex pattern for validating on-chain addresses. */
  addressPattern: string;
  enabled: boolean;
}

/**
 * Full catalog section. Service/capability flags follow the service registry
 * pattern (CLAUDE.md §7): `'crypto.buy'`, `'crypto.sell'`, etc.
 */
export interface CatalogConfig {
  assets: Record<string, CatalogAsset>;
  fiats: Record<string, CatalogFiat>;
  networks: Record<string, CatalogNetwork>;
  /** Capability / service enable flags. Fail-closed: absent === false. */
  capabilities: Record<string, boolean>;
}

export interface AppConfig {
  pricing: PricingConfig;
  limits: LimitsConfig;
  auth: AuthConfig;
  directive: DirectiveConfig;
  buy: BuyConfig;
  providers: ProvidersConfig;
  catalog: CatalogConfig;
}

export default (): AppConfig => ({
  // ── Asset / fiat / network catalog (task X1, CLAUDE.md §7) ─────────────
  // Each entry is a config-layer value; the DB-admin AppSetting layer will be
  // able to override capability flags at runtime (hot-reload) without a deploy.
  // BTC is intentionally NOT registered — Blockradar has no BTC WaaS (ADR-0006).
  catalog: {
    assets: {
      USDT: {
        symbol: 'USDT',
        displayName: 'USDT',
        kind: 'crypto',
        decimals: 6,
        networks: ['TRON'],
        // The Blockradar asset id is the canonical source of truth for USDT-on-TRON.
        // `providers.blockradar.usdtTronAssetId` below is kept for backward-compat
        // with existing BlockradarProvider consumers until task X3 reconciles them.
        providers: {
          blockradar: { assetId: 'f56d297c-a3db-4cda-95bd-180b54679070' },
        },
        enabled: true,
      },
    },
    fiats: {
      NGN: {
        code: 'NGN',
        displayName: 'Naira',
        symbol: '₦',
        decimals: 2,
        enabled: true,
      },
    },
    networks: {
      TRON: {
        id: 'TRON',
        displayName: 'TRON (TRC-20)',
        // Standard TRC-20 address: starts with T, followed by 33 Base58 chars.
        addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
        enabled: true,
      },
    },
    capabilities: {
      'crypto.buy': true,
      'crypto.sell': true,
      'crypto.send': true,
      'crypto.receive': true,
      'crypto.swap': false, // Deferred — no DEX integration at launch.
    },
  },
  buy: {
    // 50 bps = 0.5% allowed drift. Admin-tunable later (DB-admin AppSetting layer).
    maxDriftBps: 50,
  },
  pricing: {
    spreadBps: 150,
    processingFeeBps: 100,
    expiresInSec: 30,
    assets: {
      USDT: { baseRate: 1600, cryptoDecimals: 6 },
      BTC: { baseRate: 100_000_000, cryptoDecimals: 8 },
    },
  },
  directive: {
    // 5-minute window: enough for a user to complete PIN/confirmation on WhatsApp.
    // Admin-tunable later (DB-admin AppSetting layer, root CLAUDE.md §7).
    ttlSeconds: 300,
  },
  limits: {
    // Tier 1 — basic KYC: moderate daily limits to reduce exposure (NGN).
    tier_1: {
      perTxFiatMax: 50_000,
      dailyFiatMax: 200_000,
      dailyTxCountMax: 10,
    },
    // Tier 2 — enhanced KYC: higher throughput for regular users.
    tier_2: {
      perTxFiatMax: 500_000,
      dailyFiatMax: 2_000_000,
      dailyTxCountMax: 30,
    },
    // Tier 3 — full KYC: high-volume / business users.
    tier_3: {
      perTxFiatMax: 5_000_000,
      dailyFiatMax: 20_000_000,
      dailyTxCountMax: 100,
    },
  },
  auth: {
    pin: {
      // Admin-tunable later (DB-admin AppSetting layer, root CLAUDE.md §7).
      maxAttempts: 5,
      lockoutMinutes: 15,
      scryptKeyLen: 64,
    },
  },
  providers: {
    blockradar: {
      // USDT-on-TRON asset id in the Blockradar API (ADR-0006). Not a secret — kept
      // in config (not env) because it is a provider constant, not an infra/secret value.
      usdtTronAssetId: 'f56d297c-a3db-4cda-95bd-180b54679070',
      network: 'TRON',
    },
  },
});
