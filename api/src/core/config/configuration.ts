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
  /** Base mid-market rate per 1 unit of the crypto asset, keyed by fiat code. */
  baseRates: Record<string, number>;
  /** Platform spread for BUY quotes (marks up the rate; user gets less crypto). */
  buySpreadBps: number;
  /** Platform spread for SELL quotes (marks down the rate; user gets less fiat). */
  sellSpreadBps: number;
  cryptoDecimals: number;
  /**
   * Whether this asset can be bought/sold for fiat via the buy/sell flows.
   * Defaults to `true` when absent (all existing assets are fiat-tradeable).
   * Set to `false` for valuation-only assets (e.g. TRX) that have a baseRate
   * for wallet display purposes but must NOT be buyable/sellable in fiat.
   * ConfigRateProvider.getRate() throws when fiatTradeable === false so the
   * buy/sell proposal flows fail-closed without any per-asset code in the engine.
   */
  fiatTradeable?: boolean;
}

export interface PricingConfig {
  processingFeeBps: number;
  expiresInSec: number;
  assets: Record<string, AssetPricing>;
}

/** Per-KYC-tier transaction limits for a single fiat currency. All values are admin-tunable later. */
export interface TierLimits {
  /** Maximum fiat amount per single transaction. */
  perTxFiatMax: number;
  /** Maximum cumulative fiat amount within a rolling 24-hour window. */
  dailyFiatMax: number;
  /** Maximum number of transactions within a rolling 24-hour window. */
  dailyTxCountMax: number;
}

/**
 * KYC-tier limit set for a single fiat currency. `unverified` has no entry —
 * any transaction attempt fails the KYC check before limits are consulted.
 *
 * TODO(config-admin): once the DB-admin AppSetting layer is built, these
 * defaults should be overridable at runtime without a deploy (root CLAUDE.md §7).
 */
export interface FiatLimits {
  tier_1: TierLimits;
  tier_2: TierLimits;
  tier_3: TierLimits;
}

/** Per-fiat, per-KYC-tier limits, keyed by fiat code (e.g. 'NGN'). Admin-tunable. */
export type LimitsConfig = Record<string, FiatLimits>;

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

export interface JwtConfig {
  /** Access-token validity (seconds). Short — refresh rotates. */
  accessTtlSeconds: number;
  /** Refresh-token validity (seconds) — also the Session row lifetime. */
  refreshTtlSeconds: number;
}

export interface OtpConfig {
  /** Login OTP validity (seconds). */
  ttlSeconds: number;
  /** Number of digits in a login OTP. */
  length: number;
  /** Max wrong-OTP attempts before the challenge is invalidated. */
  maxAttempts: number;
}

export interface EmailTokenConfig {
  /** Email-verification link validity (seconds). */
  ttlSeconds: number;
}

export interface AuthConfig {
  pin: PinConfig;
  stepUp: StepUpConfig;
  jwt: JwtConfig;
  otp: OtpConfig;
  emailToken: EmailTokenConfig;
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

/** Swap-execution configuration (CLAUDE.md §7). */
export interface SwapConfig {
  /**
   * Maximum allowed swap rate drift in basis points between the quote stored at
   * proposal time and the re-quote at execution time. If drift exceeds this the
   * engine throws QuoteDriftError and the user must re-propose.
   * Admin-tunable later (DB-admin AppSetting layer, root §7).
   */
  maxDriftBps: number;
  /**
   * Platform spread folded INTO the displayed swap rate (bps).
   * Folded by the proposal builder before returning SwapProposalConfirmation —
   * NEVER surfaced as a separate line item (root CLAUDE.md §3.1).
   * Admin-tunable later (DB-admin AppSetting layer, root §7).
   */
  spreadBps: number;
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
   * Travel-Rule data-capture threshold per fiat code, in major units.
   * Keyed by the fiat currency code returned by AssetRegistry.defaultFiat()
   * (e.g. { NGN: 1_000_000 } = ₦1,000,000 per FATF Travel Rule / CBN circular).
   *
   * When the crypto-equivalent fiat value of a send proposal reaches or exceeds
   * the threshold for the base fiat, the proposal sets requiresTravelRule=true.
   * The full TravelRuleData capture happens at execution (Task N3b).
   *
   * Adding a new fiat = add a key here; no code change required.
   *
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  travelRuleThresholds: Record<string, number>;

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
  /**
   * The `blockchain` query-param value expected by the Blockradar AML lookup
   * API (`GET /v1/aml/lookup?address=&blockchain=`).
   *
   * Config-driven for multi-network extensibility: new networks only need an
   * entry here — no code changes required.  Absent = BlockradarAmlScreener
   * throws (fail-closed; unknown network must not be silently skipped).
   *
   * e.g. TRON → "tron", Ethereum → "ethereum", BSC → "bsc"
   */
  amlBlockchain?: string;
  /**
   * Blockradar master wallet id for this network. Used by BlockradarProvider to
   * resolve the correct master wallet when provisioning child addresses and
   * performing balance / withdrawal operations.
   *
   * Config-driven for multi-network extensibility: adding a new network only
   * requires an entry here — no code changes in BlockradarProvider.
   *
   * At launch: TRON → env `BLOCKRADAR_MASTER_WALLET_ID` (the env var value is
   * injected into the catalog defaults in configuration.ts). Absent = error at
   * runtime (fail-closed: callers must configure a master wallet id per network).
   */
  masterWalletId?: string;
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

/**
 * Statement / transaction-history configuration (CLAUDE.md §7).
 * All values are admin-tunable later via the DB-admin AppSetting layer.
 */
export interface StatementConfig {
  /** TTL (seconds) for a signed statement download link. Default 900 (15 min). */
  linkTtlSeconds: number;
  /** Max history window in days; longer requests are clamped. Default 365. */
  maxWindowDays: number;
  /** Max rows returned to the chat card / statement. Default 100 (truncation surfaced). */
  rowCap: number;
  /** Fixed offset (minutes) for local day boundaries. WAT = UTC+1, no DST → 60. */
  timezoneOffsetMinutes: number;
}

/** Voice note upload limits. Admin-tunable later (DB-admin AppSetting layer, §7). */
export interface VoiceConfig {
  /**
   * Maximum allowed voice note upload size in bytes.
   * Default: 15 MB. Enforced by the voice endpoint (Task 9) before transcription.
   * Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  maxUploadBytes: number;
  /**
   * Allowed MIME types for voice note uploads.
   * Enforced by the voice endpoint (Task 9) before transcription.
   * Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  allowedMimeTypes: string[];
}

/** WhatsApp media size limits. Admin-tunable later (DB-admin AppSetting layer, §7). */
export interface WhatsAppMediaConfig {
  /**
   * Maximum allowed WhatsApp media payload size in bytes.
   * Default: 25 MB (Meta's stated per-message media limit).
   * Enforced by the WhatsApp media client (Task 14) before download/processing.
   * Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
   * TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
   */
  maxMediaBytes: number;
}

/**
 * Media configuration (voice note uploads + WhatsApp media).
 * All values are admin-tunable later via the DB-admin AppSetting layer (§7).
 */
export interface MediaConfig {
  voice: VoiceConfig;
  whatsapp: WhatsAppMediaConfig;
}

export interface AppConfig {
  pricing: PricingConfig;
  limits: LimitsConfig;
  auth: AuthConfig;
  directive: DirectiveConfig;
  buy: BuyConfig;
  sell: SellConfig;
  swap: SwapConfig;
  compliance: ComplianceConfig;
  catalog: CatalogConfig;
  beneficiary: BeneficiaryConfig;
  reconciliation: ReconciliationConfig;
  statement: StatementConfig;
  media: MediaConfig;
}

/**
 * Boot-time cross-validation for multi-currency completeness (audit #25).
 *
 * The product's extensibility guarantee is "enabling a fiat = flip the
 * `enabled` flag, no code change" (root CLAUDE.md §7). That only holds if the
 * layered config actually carries the matching pricing + limits for the fiat —
 * otherwise a flag flip produces opaque 500s (ConfigRateProvider /
 * KycGateService throw raw Errors) instead of working flows.
 *
 * This asserts, fail-closed at startup, that EVERY catalog-enabled fiat has:
 *   1. a `limits[fiat]` block (per-tier transaction caps), and
 *   2. a `pricing.assets[asset].baseRates[fiat]` entry for every asset that is
 *      both catalog-enabled AND fiat-tradeable (valuation-only assets such as a
 *      `fiatTradeable: false` asset are skipped — they can't be bought/sold).
 *
 * Throws (failing boot) on the first violation. Disabled fiats are ignored —
 * their config may legitimately be incomplete until they go live.
 */
export function validateConfig(cfg: AppConfig): void {
  const enabledFiats = Object.values(cfg.catalog.fiats)
    .filter((fiat) => fiat.enabled)
    .map((fiat) => fiat.code);

  // Assets that can actually be bought/sold for fiat: catalog-enabled and not
  // explicitly marked valuation-only (fiatTradeable defaults to true).
  const tradeableAssets = Object.keys(cfg.pricing.assets).filter((symbol) => {
    const catalogAsset = cfg.catalog.assets[symbol];
    const isCatalogEnabled = catalogAsset ? catalogAsset.enabled : false;
    const isFiatTradeable = cfg.pricing.assets[symbol].fiatTradeable !== false;
    return isCatalogEnabled && isFiatTradeable;
  });

  for (const fiat of enabledFiats) {
    if (!cfg.limits[fiat]) {
      throw new Error(
        `Config invariant violated: fiat '${fiat}' is enabled in the catalog ` +
          `but has no limits block (config.limits.${fiat}). Enabling a fiat ` +
          `requires adding its limits + pricing baseRates (root CLAUDE.md §7).`,
      );
    }

    for (const asset of tradeableAssets) {
      const baseRate = cfg.pricing.assets[asset].baseRates[fiat];
      if (baseRate === undefined) {
        throw new Error(
          `Config invariant violated: fiat '${fiat}' is enabled but asset ` +
            `'${asset}' has no pricing baseRate for it ` +
            `(config.pricing.assets.${asset}.baseRates.${fiat}). Enabling a ` +
            `fiat requires a baseRate for every enabled fiat-tradeable asset ` +
            `(root CLAUDE.md §7).`,
        );
      }
    }
  }
}

const buildConfig = (): AppConfig => ({
  // ── Asset / fiat / network catalog (task X1, CLAUDE.md §7) ────────────
  // Each entry is a config-layer value; the DB-admin AppSetting layer will be
  // able to override capability flags at runtime (hot-reload) without a deploy.
  // BTC is intentionally NOT registered — Blockradar has no BTC WaaS (ADR-0006).
  catalog: {
    assets: {
      // USDT is the only static catalog entry at launch.
      // The Blockradar asset id (providers.blockradar.assetId) is intentionally
      // NOT hardcoded here — it varies per wallet (testnet vs mainnet) and is
      // discovered at boot via CatalogSyncService → provider.listWalletAssets().
      // The sync merges the real runtime assetId into AssetRegistry's
      // discoveredProviderIds overlay; assetProviderId('USDT', 'blockradar')
      // returns the discovered value first.
      //
      // Static pricing (pricing.assets.USDT) and limits remain keyed by symbol —
      // those values are independent of the Blockradar asset UUID.
      USDT: {
        symbol: 'USDT',
        displayName: 'USDT',
        kind: 'crypto',
        decimals: 6,
        networks: ['TRON'],
        // providers intentionally empty — populated at boot by CatalogSyncService.
        providers: {},
        enabled: true,
      },
    },
    fiats: {
      // ── Live at launch ──────────────────────────────────────────────────
      NGN: {
        code: 'NGN',
        displayName: 'Naira',
        symbol: '₦',
        decimals: 2,
        enabled: true,
      },
      // ── Supported but NOT yet live (enabled: false) ─────────────────────
      // Flip `enabled` to true once the Flutterwave collection + disbursement
      // for that market is live-tested and the compliance review is complete.
      // No code change required — only a config/DB-admin flag flip (CLAUDE.md §7).
      GHS: {
        code: 'GHS',
        displayName: 'Ghanaian Cedi',
        symbol: 'GH₵',
        decimals: 2,
        enabled: false,
      },
      KES: {
        code: 'KES',
        displayName: 'Kenyan Shilling',
        symbol: 'KSh',
        decimals: 2,
        enabled: false,
      },
      UGX: {
        code: 'UGX',
        displayName: 'Ugandan Shilling',
        symbol: 'USh',
        decimals: 0,
        enabled: false,
      },
      TZS: {
        code: 'TZS',
        displayName: 'Tanzanian Shilling',
        symbol: 'TSh',
        decimals: 0,
        enabled: false,
      },
      RWF: {
        code: 'RWF',
        displayName: 'Rwandan Franc',
        symbol: 'FRw',
        decimals: 0,
        enabled: false,
      },
      ZAR: {
        code: 'ZAR',
        displayName: 'South African Rand',
        symbol: 'R',
        decimals: 2,
        enabled: false,
      },
      USD: {
        code: 'USD',
        displayName: 'US Dollar',
        symbol: '$',
        decimals: 2,
        enabled: false,
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
          // Flat TRX send fee (native TRC transfer; cheap bandwidth/energy).
          // Admin-tunable like the USDT fee.
          TRX: '1',
        },
        // Blockradar AML lookup blockchain param for TRON addresses.
        // See BlockradarAmlScreener (compliance/infrastructure).
        amlBlockchain: 'tron',
        // TRON master wallet id: resolved from env at boot.
        // BLOCKRADAR_MASTER_WALLET_TRON overrides BLOCKRADAR_MASTER_WALLET_ID
        // so multi-network deployments can have per-network keys while keeping
        // the legacy single-network variable working at launch.
        masterWalletId:
          process.env['BLOCKRADAR_MASTER_WALLET_TRON'] ??
          process.env['BLOCKRADAR_MASTER_WALLET_ID'] ??
          '',
      },
    },
    capabilities: {
      'crypto.buy': true,
      'crypto.sell': true,
      'crypto.send': true,
      'crypto.receive': true,
      // Enabled: BlockradarSwapProvider (SWAP_MOCK_MODE=true → MockSwapProvider,
      // SWAP_MOCK_MODE=false → real Blockradar). Requires ≥2 enabled assets in the
      // catalog (USDT + TRX at launch). Engine gates on KYC + limits + sanctions
      // before calling the provider (root CLAUDE.md §3.1 / §3.3).
      'crypto.swap': true,
    },
    // Validity window for send quotes (300s / 5 min — same as buy/sell).
    // A human needs time to read the itemized confirmation and enter a PIN;
    // 30s was too short to complete the flow. Matches the directive TTL (300s).
    // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
    // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
    sendQuoteExpiresInSec: 300,
  },
  buy: {
    // 50 bps = 0.5% allowed drift. Admin-tunable later (DB-admin AppSetting layer).
    maxDriftBps: 50,
  },
  sell: {
    // 50 bps = 0.5% allowed drift. Admin-tunable later (DB-admin AppSetting layer).
    maxDriftBps: 50,
  },
  swap: {
    // 50 bps = 0.5% allowed drift on the re-quote at execute time.
    // Admin-tunable later (DB-admin AppSetting layer, root §7).
    maxDriftBps: 50,
    // 100 bps = 1% platform spread folded into the displayed rate (never a line item).
    // Admin-tunable later (DB-admin AppSetting layer, root §7).
    spreadBps: 100,
  },
  compliance: {
    // FATF Travel Rule threshold per fiat code, in major units.
    // Above this fiat-equivalent value the send proposal sets requiresTravelRule:true.
    // Full TravelRuleData capture happens at execution (Task N3b).
    // Non-live currencies have thresholds defined here so they are ready when enabled;
    // they are never reached in practice while the currency has enabled:false in catalog.
    // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
    // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
    travelRuleThresholds: {
      NGN: 1_000_000, // CBN circular: ₦1,000,000
      // Non-live: placeholders aligned to FATF Travel Rule equivalents (~USD 1,000).
      // Update with local regulator thresholds before enabling each currency.
      GHS: 15_000, // ~GH₵15,000 ≈ USD 1,000 (indicative)
      KES: 130_000, // ~KSh130,000 ≈ USD 1,000 (indicative)
      UGX: 3_700_000, // ~USh3,700,000 ≈ USD 1,000 (indicative)
      TZS: 2_600_000, // ~TSh2,600,000 ≈ USD 1,000 (indicative)
      RWF: 1_300_000, // ~FRw1,300,000 ≈ USD 1,000 (indicative)
      ZAR: 18_000, // ~R18,000 ≈ USD 1,000 (indicative)
      USD: 1_000, // Standard FATF threshold
    },
    // Empty by default — no addresses flagged. Populate in config to test the
    // blocked path with MockSanctionsScreener (see mock-sanctions.screener.ts).
    sanctionsDenylist: [] as string[],
  },
  pricing: {
    processingFeeBps: 100,
    // Buy/sell quote validity (300s / 5 min). A human needs time to read the
    // confirmation and enter a PIN; 30s was too short to complete the flow.
    expiresInSec: 300,
    assets: {
      // buySpreadBps=150 matches the old global spreadBps so existing BUY quotes are unchanged.
      // sellSpreadBps is independently tunable — set to 150 as the conservative default.
      USDT: {
        baseRates: { NGN: 1600 },
        buySpreadBps: 150,
        sellSpreadBps: 150,
        cryptoDecimals: 6,
      },
      BTC: {
        baseRates: { NGN: 100_000_000 },
        buySpreadBps: 150,
        sellSpreadBps: 150,
        cryptoDecimals: 8,
      },
      // TRX: fiat-tradeable (buy/sell against NGN) in addition to swap + wallet
      // valuation. Multi-asset from the start — TRX is a first-class tradeable
      // asset, not swap-only. The spread is the platform margin folded into the
      // displayed rate (NEVER surfaced as a line item, CLAUDE.md §3.1).
      TRX: {
        baseRates: { NGN: 520 },
        buySpreadBps: 150,
        sellSpreadBps: 150,
        cryptoDecimals: 6,
        fiatTradeable: true,
      },
    },
  },
  directive: {
    // 5-minute window: enough for a user to complete PIN/confirmation on WhatsApp.
    // Admin-tunable later (DB-admin AppSetting layer, root CLAUDE.md §7).
    ttlSeconds: 300,
  },
  limits: {
    NGN: {
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
    jwt: {
      // 1-hour access token; 30-day refresh. Admin-tunable later (DB-admin layer, §7).
      accessTtlSeconds: 60 * 60,
      refreshTtlSeconds: 30 * 24 * 60 * 60,
    },
    otp: {
      // 5-minute OTP, 6 digits, 5 attempts. Admin-tunable later (§7).
      ttlSeconds: 5 * 60,
      length: 6,
      maxAttempts: 5,
    },
    emailToken: {
      // 24-hour email-verification link. Admin-tunable later (§7).
      ttlSeconds: 24 * 60 * 60,
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
  statement: {
    // 15-minute signed-link validity, 1-year max history window, 100-row page cap,
    // and WAT (UTC+1, no DST) day boundaries. Admin-tunable later (DB-admin layer, §7).
    linkTtlSeconds: 900,
    maxWindowDays: 365,
    rowCap: 100,
    timezoneOffsetMinutes: 60,
  },
  media: {
    voice: {
      // 15 MB — reasonable ceiling for a voice note before transcription.
      // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
      // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
      maxUploadBytes: 15_000_000,
      // Accepted voice note MIME types. Task 9 (POST /chat/voice) validates against this list.
      allowedMimeTypes: [
        'audio/webm',
        'audio/mp4',
        'audio/mpeg',
        'audio/ogg',
        'audio/wav',
      ],
    },
    whatsapp: {
      // 25 MB — Meta's per-message media limit (audio/image/document/video).
      // Enforced by the WhatsApp media client (Task 14) before download/processing.
      // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
      // TODO(config-admin): expose via AppSetting once the DB-admin layer is built.
      maxMediaBytes: 25_000_000,
    },
  },
});

/**
 * Config factory (the @nestjs/config `load` entry). Builds the JSON-defaults
 * layer and runs the boot-time cross-validation (#25) so a misconfigured
 * enabled-fiat fails startup rather than producing opaque 500s at runtime.
 */
export default (): AppConfig => {
  const cfg = buildConfig();
  validateConfig(cfg);
  return cfg;
};
