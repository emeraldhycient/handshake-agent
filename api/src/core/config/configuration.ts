/**
 * JSON-defaults layer of the layered config (root CLAUDE.md §7). These are the
 * committed baseline values; env overrides infra/secrets and the DB-admin layer
 * (not built yet) overrides business-tunable values at runtime.
 *
 * NOTE: `baseRate` here is a placeholder default — production replaces the
 * ConfigRateProvider with a live pricing-feed adapter. `buySpreadBps` /
 * `sellSpreadBps` / `processingFeeBps` are genuinely admin-tunable and belong
 * in config.
 */
export interface AssetPricing {
  baseRate: number;
  /** Platform spread for BUY quotes (marks up the rate; user gets less crypto). */
  buySpreadBps: number;
  /** Platform spread for SELL quotes (marks down the rate; user gets less fiat). */
  sellSpreadBps: number;
  cryptoDecimals: number;
}

export interface PricingConfig {
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

/**
 * Step-up authentication configuration (Fix G, CLAUDE.md §3.4 / §7).
 * Controls how long a completed step-up on a Session remains valid.
 */
export interface StepUpConfig {
  /**
   * Time-to-live in seconds for a recorded step-up on a Session.
   * After this window, assertStepUpFresh will throw StepUpRequiredError.
   * Admin-tunable later (DB-admin AppSetting layer, root §7).
   * Default: 900 seconds (15 minutes).
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  ttlSeconds: number;
}

export interface AuthConfig {
  pin: PinConfig;
  stepUp: StepUpConfig;
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

/** Sell-execution configuration (task S4b, CLAUDE.md §7). */
export interface SellConfig {
  /**
   * Maximum allowed FX rate drift in basis points between the original quote and
   * the re-quote at execution time for a sell order.
   * Admin-tunable later (DB-admin AppSetting layer, root §7).
   */
  maxDriftBps: number;
}

/**
 * Beneficiary module configuration (Fix E, CLAUDE.md §7).
 * Controls the MockNameEnquiry adapter and crypto cooling-off period.
 */
export interface BeneficiaryConfig {
  /**
   * Default crypto cooling-off window in seconds (IDN-08).
   * Admin-tunable via the DB-admin AppSetting layer.
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  cryptoCoolingOffSeconds: number;
  /**
   * Account number that MockNameEnquiry treats as "not found" (throws
   * NameEnquiryFailedError). Used to exercise the negative path in tests and
   * staging. The real provider will not read this field.
   * Empty string (default) means no account is configured as bad.
   */
  nameEnquiryBadAccount: string;
  /**
   * Deterministic resolved name returned by MockNameEnquiry for all
   * non-bad-account lookups. Defaults to "MOCK ACCOUNT HOLDER".
   * A real provider resolves from the bank — this field is mock-only.
   */
  nameEnquiryResolvedName: string;
}

/**
 * Compliance / AML configuration (task N3a, CLAUDE.md §7).
 * All values are admin-tunable via the DB-admin AppSetting layer.
 */
export interface ComplianceConfig {
  /**
   * NGN-equivalent threshold above which a Travel Rule data-capture flag
   * must be set on a send proposal (FATF Travel Rule / CBN circular).
   * Expressed in NGN major units (e.g. 1_000_000 = ₦1,000,000).
   *
   * The full TravelRuleData capture happens at execution (Task N3b); for
   * proposals this flag triggers a note to the user that additional information
   * will be required at execution time.
   *
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  travelRuleThresholdNgn: number;

  /**
   * Denylist of crypto addresses that MockSanctionsScreener flags as
   * sanctioned. Used in test / staging environments to exercise the blocked
   * path without a real sanctions provider.  The JSON-defaults baseline is an
   * empty array (no addresses flagged); operators populate this via config.
   *
   * The real sanctions adapter (OpenSanctions, TRM) will NOT read this field —
   * it is an operational knob for the mock only.
   *
   * TODO(config-admin): replace with the DB-admin AppSetting layer so operators
   * can update the list without a deploy.
   */
  sanctionsDenylist: string[];
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
  /**
   * Flat on-chain network fee per asset for send transactions, in major units.
   * Key is the asset symbol (e.g. 'USDT'); value is a decimal string (e.g. '1').
   * Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7) without a
   * deploy.  Absent entries mean no configured fee (treat as '0').
   *
   * TRC-20 USDT: Blockradar absorbs the TRX gas cost and charges a flat USDT
   * fee from the transferred amount. The initial default is '1' USDT per send.
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  networkFeeCrypto: Record<string, string>;
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
  /**
   * Validity window in seconds for send quotes. The quote must be confirmed
   * before this window expires.
   * Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  sendQuoteExpiresInSec: number;
}

/**
 * Settlement reconciliation configuration (Fix F, CLAUDE.md §7).
 *
 * Controls the SettlementReconciliationService cron that re-drives settlement
 * for outbox rows whose webhook was missed.
 *
 * Note: the cron schedule itself is hard-coded in the @Cron decorator
 * (every 2 minutes) because NestJS decorators are evaluated at class-compile
 * time and cannot read runtime config values. Changing the tick frequency
 * requires a code change and redeploy — this is acceptable for an infra
 * tuning parameter (not a business-tunable value per root CLAUDE.md §7).
 */
export interface ReconciliationConfig {
  /**
   * Grace window in seconds: only pick up rows older than this to avoid
   * racing with a webhook that is still in-flight.
   * Default: 120 seconds (2 minutes).
   */
  gracePeriodSec: number;
  /**
   * Maximum number of outbox rows to process per tick.
   * Bounds each run to prevent overloading the settlement engine.
   * Default: 20.
   */
  batchSize: number;
}

export interface AppConfig {
  pricing: PricingConfig;
  limits: LimitsConfig;
  auth: AuthConfig;
  directive: DirectiveConfig;
  buy: BuyConfig;
  sell: SellConfig;
  compliance: ComplianceConfig;
  catalog: CatalogConfig;
  beneficiary: BeneficiaryConfig;
  reconciliation: ReconciliationConfig;
}

export default (): AppConfig => ({
  // ── Asset / fiat / network catalog (task X1, CLAUDE.md §7) ────────────
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
        // The Blockradar asset id in the catalog is the canonical source of truth
        // for USDT-on-TRON (task X3 — providers.blockradar.usdtTronAssetId removed).
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
        // Flat USDT network fee per on-chain send on TRC-20.
        // Blockradar absorbs the TRX gas and charges a flat USDT fee.
        // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
        // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
        networkFeeCrypto: {
          USDT: '1',
        },
      },
    },
    capabilities: {
      'crypto.buy': true,
      'crypto.sell': true,
      'crypto.send': true,
      'crypto.receive': true,
      'crypto.swap': false, // Deferred — no DEX integration at launch.
    },
    // Validity window for send quotes (30 seconds — same as buy/sell).
    // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
    // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
    sendQuoteExpiresInSec: 30,
  },
  buy: {
    // 50 bps = 0.5% allowed drift. Admin-tunable later (DB-admin AppSetting layer).
    maxDriftBps: 50,
  },
  sell: {
    // 50 bps = 0.5% allowed drift. Admin-tunable later (DB-admin AppSetting layer).
    maxDriftBps: 50,
  },
  compliance: {
    // FATF Travel Rule / CBN circular threshold: ₦1,000,000 equivalent.
    // Above this NGN value the send proposal sets requiresTravelRule:true.
    // Full TravelRuleData capture happens at execution (Task N3b).
    // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
    // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
    travelRuleThresholdNgn: 1_000_000,
    // Empty by default — no addresses flagged. Populate in config to test the
    // blocked path with MockSanctionsScreener (see mock-sanctions.screener.ts).
    sanctionsDenylist: [] as string[],
  },
  pricing: {
    processingFeeBps: 100,
    expiresInSec: 30,
    assets: {
      // buySpreadBps=150 matches the old global spreadBps so existing BUY quotes are unchanged.
      // sellSpreadBps is independently tunable — set to 150 as the conservative default.
      USDT: {
        baseRate: 1600,
        buySpreadBps: 150,
        sellSpreadBps: 150,
        cryptoDecimals: 6,
      },
      BTC: {
        baseRate: 100_000_000,
        buySpreadBps: 150,
        sellSpreadBps: 150,
        cryptoDecimals: 8,
      },
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
    stepUp: {
      // 15-minute step-up validity window. Matches the directive TTL so a user
      // completing PIN within the directive window gets a full 15-minute session.
      // Admin-tunable later (DB-admin AppSetting layer, root CLAUDE.md §7).
      // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
      ttlSeconds: 900,
    },
  },
  beneficiary: {
    // 24-hour cooling-off for new crypto-address beneficiaries (IDN-08).
    // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
    // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
    cryptoCoolingOffSeconds: 24 * 60 * 60,
    // Empty by default — no account configured as "not found" for the mock.
    // Populate in config/test env to exercise the NameEnquiryFailedError path.
    nameEnquiryBadAccount: '',
    // Default resolved name returned by MockNameEnquiry for all successful lookups.
    // A real provider resolves the actual account-holder name from the bank.
    nameEnquiryResolvedName: 'MOCK ACCOUNT HOLDER',
  },
  reconciliation: {
    // Only pick up rows older than 2 minutes so we don't race in-flight webhooks.
    gracePeriodSec: 120,
    // Process at most 20 rows per tick to bound settlement-engine load.
    batchSize: 20,
  },
});
