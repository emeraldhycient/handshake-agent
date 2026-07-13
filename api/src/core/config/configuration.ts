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
import type { KycTier } from '@handshake-agent/contracts';

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
  /**
   * Optional per-(capability × currency) fiat MIN/MAX transaction bounds — the
   * pricing screen's MIN/MAX column. A product/market cap set by an operator,
   * distinct from the per-user KYC-tier limit. ENFORCE-WHEN-PRESENT (absent → no
   * per-row bound). `buy` bounds the fiat spend; `sell` bounds the fiat proceeds
   * (quote.netFiatAmount). Structurally matches the domain `AssetFiatBounds`
   * resolver shape (amount-floors.ts) — the proposal engine reads these keys.
   */
  minFiat?: Partial<Record<'buy' | 'sell', Record<string, number>>>;
  maxFiat?: Partial<Record<'buy' | 'sell', Record<string, number>>>;
}

/**
 * Live market-rate feed configuration (F1). The feed keeps the money-path base
 * rates current; `pricing.assets.<asset>.baseRates.<fiat>` is the admin FLOOR /
 * fallback the feed is validated against and falls back to. `enabled` is the
 * admin kill-switch (default true) — flip it off to serve config rates only.
 * All values are admin-tunable via the DB-admin AppSetting layer (root §7); the
 * source base URLs + optional API key are env/infra (see env.schema.ts).
 */
export interface PricingFeedConfig {
  /** Kill-switch. false → the poller does nothing and the seam serves config rates. */
  enabled: boolean;
  /** Poll cadence in seconds (LiveRateService schedules its interval from this). */
  pollIntervalSec: number;
  /** A live rate older than this (seconds) is treated as stale → config fallback. */
  stalenessSec: number;
  /**
   * Maximum accepted divergence (basis points) between a composed live rate and
   * its config-floor baseRate. Beyond this the tick is rejected (marked degraded,
   * keeps the config fallback) — a bad upstream print never moves money.
   */
  divergenceBps: number;
  /** Fiat ISO codes the feed composes rates for. */
  fiats: string[];
  /** CoinGecko `/simple/price` mapping: asset symbol → CoinGecko coin id. */
  coingecko: { ids: Record<string, string> };
  /** Quidax public ticker market slug for the USDT/NGN local override. */
  quidax: { market: string };
  /** open.er-api.com base currency for the USD→fiat legs. */
  exchangerate: { base: string };
}

export interface PricingConfig {
  processingFeeBps: number;
  expiresInSec: number;
  assets: Record<string, AssetPricing>;
  /**
   * Live-feed section (F1). Optional on the type so the many PricingConfig test
   * fixtures need not construct it; the shipped default ALWAYS provides it, and
   * the base-rate seam reads `pricing.feed?.stalenessSec` defensively.
   */
  feed?: PricingFeedConfig;
}

/** Per-KYC-tier transaction limits for a single fiat currency. All values are admin-tunable later. */
export interface TierLimits {
  /** Maximum fiat amount per single transaction. */
  perTxFiatMax: number;
  /** Maximum cumulative fiat amount within a rolling 24-hour window. */
  dailyFiatMax: number;
  /**
   * Maximum cumulative fiat amount within a rolling 7-day window. Optional on the
   * type so fixtures exercising other caps need not set it, but the shipped defaults
   * ALWAYS set it — production always enforces (KycGateService checks it when present).
   */
  weeklyFiatMax?: number;
  /**
   * Maximum NGN-equivalent of a single on-chain (crypto-address) send. Optional on the
   * type (fixtures for other caps need not set it) but the shipped defaults ALWAYS set
   * it — production always enforces (KycGateService checks it for on-chain sends when
   * present). On-chain sends are irreversible, so it may be set tighter than perTxFiatMax.
   */
  perSendOnChainFiatMax?: number;
  /**
   * Maximum number of on-chain (crypto-address) sends within a rolling 10-minute
   * window — an anti-rapid-fire velocity cap. Optional on the type (fixtures for other
   * caps need not set it) but the shipped defaults ALWAYS set it; enforced for on-chain
   * sends when present.
   */
  sendsPer10MinMax?: number;
  /** Maximum number of transactions within a rolling 24-hour window. */
  dailyTxCountMax: number;
}

/**
 * KYC-tier limit set for a single fiat currency. `unverified` has no entry —
 * any transaction attempt fails the KYC check before limits are consulted.
 *
 * These defaults are overridable at runtime via AppSetting / EffectiveConfigService
 * (the DB-admin layer now exists) — no deploy required (root CLAUDE.md §7).
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
   * Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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

/**
 * Admin-console login lockout (credential-stuffing / password-spray guard,
 * root CLAUDE.md §3.3 / §7). The IP-keyed throttle is trivially bypassed with a
 * proxy pool, so login also locks PER ACCOUNT: the failure counter is
 * incremented atomically before the argon2 verify and, past `maxAttempts`, the
 * account is locked for `lockoutMinutes`. Admin-tunable via the DB-admin
 * AppSetting layer (no deploy).
 */
export interface AdminLoginConfig {
  /** Maximum consecutive failed admin logins before the account is locked. */
  maxAttempts: number;
  /** Duration (minutes) the admin account stays locked after maxAttempts failures. */
  lockoutMinutes: number;
}

export interface AdminConfig {
  login: AdminLoginConfig;
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
   * Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
  /**
   * ISO 3166-1 alpha-2 countries whose bank rails support account name-enquiry
   * (Flutterwave `/accounts/resolve` is effectively NG/NUBAN-only today). When a
   * bank beneficiary's derived country is in this set, addBankAccount runs the
   * enquiry and persists the RESOLVED name (verified); otherwise it SKIPS the
   * enquiry and saves the user-entered name as `unverified` (never fails closed).
   * Registry-driven so enabling a new market's name-enquiry is a config flip (§7).
   */
  nameEnquiryResolvableCountries: string[];
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
   * Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
   */
  travelRuleThresholds: Record<string, number>;

  /**
   * Cooling-off window in SECONDS after a user's KYC tier changes (grant or admin
   * change) during which money moves are blocked (anti-abuse after a tier grant on a
   * possibly-compromised account, §3.3). Enforced by KycGateService against
   * User.tierChangedAt. 0 (default) disables the hold — fully configurable, always
   * enforced (enforce-when-present with a real 0-length window when 0).
   */
  tierChangeCoolingOffSeconds: number;

  /**
   * Denylist of crypto addresses that MockSanctionsScreener flags as
   * sanctioned. Used in test / staging environments to exercise the blocked
   * path without a real sanctions provider.  The JSON-defaults baseline is an
   * empty array (no addresses flagged); operators populate this via config.
   *
   * The real sanctions adapter (OpenSanctions, TRM) will NOT read this field —
   * it is an operational knob for the mock only.
   *
   * Overridable at runtime via AppSetting / EffectiveConfigService (the DB-admin
   * layer now exists) so operators can update the list without a deploy (root CLAUDE.md §7).
   */
  sanctionsDenylist: string[];

  /**
   * Sanctions ongoing-monitoring policy flags, surfaced read-only on the admin
   * sanctions screen. Admin-tunable via the DB-admin AppSetting layer (root §7);
   * toggling them from the console is a Phase-7 write.
   */
  ongoingMonitoring: {
    /** Re-screen all customers daily against updated lists. */
    reScreenDaily: boolean;
    /** Screen every counterparty on outbound transfer. */
    screenOnOutbound: boolean;
    /** Alert on new PEP (politically exposed person) matches. */
    pepAlert: boolean;
    /** Auto-block confirmed OFAC SDN-list hits. */
    autoBlockOfac: boolean;
  };
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
  /**
   * ISO 3166-1 alpha-2 country whose banking rails settle this currency
   * (e.g. NGN → 'NG'). Used to derive a bank beneficiary's country from its
   * payout currency (server-side; the client-supplied country is never trusted)
   * and to back the `GET /beneficiaries/banks?country=` dropdown. Optional so a
   * runtime-added custom fiat without a country mapping is still recognised —
   * `AssetRegistry.countryForFiat` fails closed when it is absent.
   */
  country?: string;
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
   * Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
   * Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
 * Durable inbound-webhook queue tuning (Track A). Infra parameters, not
 * business-tunable (root CLAUDE.md §7) — a code change + redeploy to alter.
 */
export interface WebhooksConfig {
  /** BullMQ automatic-retry attempts before dead-lettering. Default 5. */
  maxAttempts: number;
  /** Exponential-backoff base delay (ms) between retries. Default 2000. */
  backoffMs: number;
  /** Sweeper: only re-enqueue rows stuck in `received` older than this. Default 60s. */
  sweepGracePeriodSec: number;
  /** Sweeper: max rows re-enqueued per tick. Default 50. */
  sweepBatchSize: number;
}

/**
 * Statement / transaction-history configuration (CLAUDE.md §7).
 * All values are admin-tunable later via the DB-admin AppSetting layer.
 */
export interface StatementConfig {
  /** TTL (seconds) for a signed statement download link. Default 900 (15 min). */
  linkTtlSeconds: number;
  /** Max history window in days; longer requests are clamped. Default 400 (~1yr + headroom). */
  maxWindowDays: number;
  /** Default page size for the interactive history card / Activity feed. Default 10. */
  defaultPageSize: number;
  /** Hard cap on a single page (clamps an over-large client `limit`). Default 100. */
  maxPageSize: number;
  /** Safety cap on rows gathered for a full-range PDF statement. Default 5000. */
  statementMaxRows: number;
  /** Fixed offset (minutes) for local day boundaries. WAT = UTC+1, no DST → 60. */
  timezoneOffsetMinutes: number;
}

/** Voice note upload limits. Admin-tunable later (DB-admin AppSetting layer, §7). */
export interface VoiceConfig {
  /**
   * Maximum allowed voice note upload size in bytes.
   * Default: 15 MB. Enforced by the voice endpoint (Task 9) before transcription.
   * Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
   * Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
   */
  maxUploadBytes: number;
  /**
   * Allowed MIME types for voice note uploads.
   * Enforced by the voice endpoint (Task 9) before transcription.
   * Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
   * Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
   * Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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

/**
 * Ticketing-vertical configuration (Phase 4 wave 2). Admin-tunable via the
 * DB-admin AppSetting layer (§7). `enabled` is fail-closed (default off) — the
 * vertical ships disabled until an operator flips the flag (no deploy required).
 */
export interface TicketingConfig {
  /** Service-registry enablement flag for the ticketing vertical (§7). */
  enabled: boolean;
  /** Handshake platform commission per ticket order, in basis points. */
  commissionBps: number;
}

/**
 * Treasury oversight configuration (Wave D, root CLAUDE.md §7). Admin-tunable via
 * the DB-admin AppSetting layer — every leaf is registered in SETTING_REGISTRY
 * (`treasury.largePayoutThresholds.<CODE>`, `treasury.fiatFloatTargets.<CODE>`,
 * `treasury.lowFloatThresholdBps`).
 */
export interface TreasuryConfig {
  /**
   * Per-currency large-payout approval thresholds, keyed by fiat code in that
   * currency's MAJOR units. A queued payout/withdrawal whose fiat notional — in
   * its OWN currency — is at/above the threshold must clear maker-checker before
   * release. FAIL-CLOSED: a currency with NO entry flags EVERY payout for
   * approval until an operator configures a threshold (no silent auto-release
   * in a freshly-enabled currency).
   */
  largePayoutThresholds: Record<string, number>;
  /**
   * Per-currency operating float targets, keyed by fiat code in that currency's
   * MAJOR units. The treasury float-health view reports each currency's balance
   * against its target. OPT-IN: 0 (the shipped default for every currency) means
   * "no target" — the currency is always reported healthy — until an operator
   * sets a real target via the DB-admin layer (treasury.fiatFloatTargets.<CODE>).
   */
  fiatFloatTargets: Record<string, number>;
  /**
   * Low-float floor in basis points: a currency's float is flagged "low" when its
   * balance/target utilization drops below this fraction of its configured target
   * (e.g. 2500 = 25%). A single global knob shared by every currency's float check.
   */
  lowFloatThresholdBps: number;
}

/**
 * Embedded-agent configuration (Phase 4 wave 2). Admin-tunable via the DB-admin
 * AppSetting layer (§7). The system prompt is intentionally NOT a config value —
 * it is read-only and never editable (§3.1/§6); the ANTHROPIC_API_KEY is a secret
 * and stays env-only. `modelId` defaults to the AGENT_MODEL env value so the agent
 * behaves identically with no override.
 */
export interface AgentConfig {
  /** Enablement flag; when false AgentService throws AgentUnavailableError (§3.1). */
  enabled: boolean;
  /** The Anthropic model id used for intent extraction (mirrors env AGENT_MODEL). */
  modelId: string;
  /**
   * Upper bound on tool/graph invocations the agent may make per user turn — a
   * guardrail surfaced read-only in the admin Agent console. The current graph is a
   * single-node intent-extraction pass (no tool-call loop), so the default is 1;
   * it is a config value (not hardcoded, §7) so a future multi-node graph can raise
   * it from the DB-admin layer without a deploy.
   */
  maxToolCallsPerTurn: number;
}

/**
 * Capability-gating configuration (Task 1.2, root CLAUDE.md §7). Maps each
 * transactable capability key (matching the `catalog.capabilities` dotted
 * leaves, e.g. `crypto.buy`) to the minimum KYC tier required to use it. A
 * code-default for now — the gate (Task 1.3) reads it through
 * `EffectiveConfigService`, which serves this default until an operator
 * registers a DB-admin override (deferred follow-up, not part of this task).
 */
export interface GatingConfig {
  capabilityMinTier: Record<string, KycTier>;
}

/**
 * Sumsub (real KYC provider) configuration (Task 3.2, root CLAUDE.md §7).
 * `mockMode` / `baseUrl` mirror the env values 1:1 (read here, not re-validated —
 * env.schema.ts is the source of truth for shape/required-ness). `levelToTier`
 * maps a Sumsub verification LEVEL NAME (configured in the Sumsub dashboard,
 * env SUMSUB_LEVEL_TIER2 / SUMSUB_LEVEL_TIER3) to our internal KYC tier, so the
 * webhook handler (later task) can resolve `applicant.reviewResult.levelName` →
 * tier without a hardcoded string. Built ONLY from level names that are
 * actually present — an absent level name (e.g. in mock mode, where the local
 * .env has no SUMSUB_LEVEL_TIER2/3 yet) must not create an `undefined` key.
 */
export interface SumsubConfig {
  mockMode: boolean;
  baseUrl: string;
  levelToTier: Record<string, KycTier>;
}

/**
 * Onboarding configuration. `webPath` is the web route the WhatsApp KYC CTA
 * links to (joined onto WEB_APP_BASE_URL) — a token-less onboarding link since
 * the legacy handoff-token path was retired. A developer default (§7).
 */
export interface OnboardingConfig {
  webPath: string;
}

export interface AppConfig {
  pricing: PricingConfig;
  limits: LimitsConfig;
  auth: AuthConfig;
  admin: AdminConfig;
  directive: DirectiveConfig;
  buy: BuyConfig;
  sell: SellConfig;
  swap: SwapConfig;
  compliance: ComplianceConfig;
  catalog: CatalogConfig;
  beneficiary: BeneficiaryConfig;
  reconciliation: ReconciliationConfig;
  webhooks: WebhooksConfig;
  statement: StatementConfig;
  media: MediaConfig;
  ticketing: TicketingConfig;
  treasury: TreasuryConfig;
  agent: AgentConfig;
  gating: GatingConfig;
  sumsub: SumsubConfig;
  onboarding: OnboardingConfig;
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
  // ── Pricing-feed freshness invariant (F1) ──────────────────────────────────
  // A live rate's freshness window MUST out-live the quote validity window:
  // stalenessSec > expiresInSec. Otherwise a live rate could go stale WITHIN a
  // still-valid quote's window, flipping the money path live↔config mid-window
  // (a rate that changes source under a locked quote). Fail-closed at boot.
  const feed = cfg.pricing.feed;
  if (feed && feed.stalenessSec <= cfg.pricing.expiresInSec) {
    throw new Error(
      `Config invariant violated: pricing.feed.stalenessSec ` +
        `(${feed.stalenessSec}s) must be GREATER than pricing.expiresInSec ` +
        `(${cfg.pricing.expiresInSec}s) — a live rate must not out-live the ` +
        `quote window, or a rate can flip live↔config mid-window (root CLAUDE.md §7).`,
    );
  }

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

/**
 * Builds the [levelName, tier] pairs for `sumsub.levelToTier`, dropping any
 * entry whose env-supplied level name is absent/empty. Kept as a standalone
 * (widely-typed) helper because inlining the array literal makes TS infer
 * narrow per-element tuple types that a single type-predicate can't cover
 * (TS2677) — see configuration.spec.ts "sumsub" tests for the behavior.
 */
function buildSumsubLevelToTierEntries(): Array<[string, KycTier]> {
  const candidates: Array<[string | undefined, KycTier]> = [
    [process.env['SUMSUB_LEVEL_TIER2'], 'tier_2'],
    [process.env['SUMSUB_LEVEL_TIER3'], 'tier_3'],
  ];
  return candidates.filter((entry): entry is [string, KycTier] => !!entry[0]);
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
        country: 'NG',
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
        country: 'GH',
      },
      KES: {
        code: 'KES',
        displayName: 'Kenyan Shilling',
        symbol: 'KSh',
        decimals: 2,
        enabled: false,
        country: 'KE',
      },
      UGX: {
        code: 'UGX',
        displayName: 'Ugandan Shilling',
        symbol: 'USh',
        decimals: 0,
        enabled: false,
        country: 'UG',
      },
      TZS: {
        code: 'TZS',
        displayName: 'Tanzanian Shilling',
        symbol: 'TSh',
        decimals: 0,
        enabled: false,
        country: 'TZ',
      },
      RWF: {
        code: 'RWF',
        displayName: 'Rwandan Franc',
        symbol: 'FRw',
        decimals: 0,
        enabled: false,
        country: 'RW',
      },
      ZAR: {
        code: 'ZAR',
        displayName: 'South African Rand',
        symbol: 'R',
        decimals: 2,
        enabled: false,
        country: 'ZA',
      },
      USD: {
        code: 'USD',
        displayName: 'US Dollar',
        symbol: '$',
        decimals: 2,
        enabled: false,
        country: 'US',
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
        // Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
    // Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
    // Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
    // Cooling-off after a KYC tier change, in seconds. 0 = disabled (no hold) by
    // default; an operator sets it > 0 to hold money moves after a tier grant/change.
    tierChangeCoolingOffSeconds: 0,
    // Empty by default — no addresses flagged. Populate in config to test the
    // blocked path with MockSanctionsScreener (see mock-sanctions.screener.ts).
    sanctionsDenylist: [] as string[],
    // Ongoing-monitoring policy baseline (surfaced read-only on the admin sanctions
    // screen). Conservative defaults: continuous screening on, auto-block OFAC off
    // (a confirmed OFAC hit still routes to a human disposition, never auto-money-move).
    ongoingMonitoring: {
      reScreenDaily: true,
      screenOnOutbound: true,
      pepAlert: true,
      autoBlockOfac: false,
    },
  },
  pricing: {
    processingFeeBps: 100,
    // Buy/sell quote validity (300s / 5 min). A human needs time to read the
    // confirmation and enter a PIN; 30s was too short to complete the flow.
    expiresInSec: 300,
    // ── Live market-rate feed (F1, CLAUDE.md §7) ─────────────────────────────
    // NO mock mode: the poller always runs when `enabled`. In local/dev without
    // network, source fetches fail → rates go degraded → the seam serves the
    // baseRates below (visual-verify still works). `enabled` is the admin
    // kill-switch; staleness / divergence / cadence are admin-tunable.
    feed: {
      enabled: true,
      pollIntervalSec: 300,
      stalenessSec: 900,
      // 1500 bps = 15% is the INTENDED product tolerance band (not a placeholder).
      // Generous band: an NGN parallel-market vs config-floor gap is real, but a
      // >15% jump vs the admin floor is almost certainly a bad print / wrong
      // quote-currency → reject and keep the config fallback.
      divergenceBps: 1500,
      // Fiats to compose. Only NGN is live at launch; the rest are pre-wired so
      // enabling a market stays a flag flip (§7) — a fiat with no config baseRate
      // simply gets no live entry and keeps failing closed until priced.
      fiats: ['NGN', 'GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ZAR', 'USD'],
      // Asset symbol → CoinGecko coin id (batched /simple/price lookup).
      coingecko: {
        ids: { USDT: 'tether', BTC: 'bitcoin', TRX: 'tron' },
      },
      // Quidax public ticker market slug — the Nigeria-local USDT/NGN override
      // (more representative of the on-ground rate than a USD-derived cross).
      quidax: { market: 'usdtngn' },
      // open.er-api.com base for the USD→fiat legs.
      exchangerate: { base: 'USD' },
    },
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
        weeklyFiatMax: 1_000_000,
        perSendOnChainFiatMax: 50_000,
        sendsPer10MinMax: 5,
        dailyTxCountMax: 10,
      },
      // Tier 2 — enhanced KYC: higher throughput for regular users.
      tier_2: {
        perTxFiatMax: 500_000,
        dailyFiatMax: 2_000_000,
        weeklyFiatMax: 10_000_000,
        perSendOnChainFiatMax: 500_000,
        sendsPer10MinMax: 20,
        dailyTxCountMax: 30,
      },
      // Tier 3 — full KYC: high-volume / business users.
      tier_3: {
        perTxFiatMax: 5_000_000,
        dailyFiatMax: 20_000_000,
        weeklyFiatMax: 100_000_000,
        perSendOnChainFiatMax: 5_000_000,
        sendsPer10MinMax: 50,
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
      // Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
  admin: {
    login: {
      // Per-account admin-login lockout (credential-stuffing guard, §3.3). More
      // permissive than the end-user PIN cap (5) since MFA is the second factor,
      // but still finite so password-spray cannot run indefinitely behind a proxy
      // pool. Admin-tunable later (DB-admin AppSetting layer, root CLAUDE.md §7).
      maxAttempts: 10,
      lockoutMinutes: 15,
    },
  },
  beneficiary: {
    // 24-hour cooling-off for new crypto-address beneficiaries (IDN-08).
    // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
    // Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
    cryptoCoolingOffSeconds: 24 * 60 * 60,
    // Empty by default — no account configured as "not found" for the mock.
    // Populate in config/test env to exercise the NameEnquiryFailedError path.
    nameEnquiryBadAccount: '',
    // Default resolved name returned by MockNameEnquiry for all successful lookups.
    // A real provider resolves the actual account-holder name from the bank.
    nameEnquiryResolvedName: 'MOCK ACCOUNT HOLDER',
    // Countries whose bank rails support account name-enquiry today. NG only
    // (Flutterwave /accounts/resolve is NUBAN-only); other markets save the
    // user-entered name as `unverified`. Add a market's code here (config/DB-admin,
    // §7) once its name-enquiry rail is live — no code change required.
    nameEnquiryResolvableCountries: ['NG'],
  },
  reconciliation: {
    // Only pick up rows older than 2 minutes so we don't race in-flight webhooks.
    gracePeriodSec: 120,
    // Process at most 20 rows per tick to bound settlement-engine load.
    batchSize: 20,
  },
  webhooks: {
    // BullMQ retries a failed webhook 5 times with exponential backoff (2s base:
    // ~2s, 4s, 8s, 16s) before dead-lettering it for an admin replay.
    maxAttempts: 5,
    backoffMs: 2_000,
    // Sweeper re-enqueues rows stuck in `received` > 60s (covers a Redis-down
    // enqueue miss at ACK time), at most 50 per tick.
    sweepGracePeriodSec: 60,
    sweepBatchSize: 50,
  },
  statement: {
    // 15-minute signed-link validity; ~1-year (400-day) max window with headroom so
    // "last year" isn't trimmed; 10-row default page; 100-row hard page cap; 5000-row
    // full-statement safety cap; WAT (UTC+1, no DST) day boundaries.
    // Admin-tunable later (DB-admin layer, §7).
    linkTtlSeconds: 900,
    maxWindowDays: 400,
    defaultPageSize: 10,
    maxPageSize: 100,
    statementMaxRows: 5000,
    timezoneOffsetMinutes: 60,
  },
  media: {
    voice: {
      // 15 MB — reasonable ceiling for a voice note before transcription.
      // Admin-tunable via the DB-admin AppSetting layer (CLAUDE.md §7).
      // Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
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
      // Overridable at runtime via AppSetting / EffectiveConfigService (DB-admin layer now exists, root CLAUDE.md §7).
      maxMediaBytes: 25_000_000,
    },
  },
  // ── Ticketing vertical (Phase 4 wave 2, CLAUDE.md §7) ──────────────────────
  // Fail-closed: ships DISABLED until an operator flips the flag (no deploy).
  // commissionBps is 0 by default; admin-tunable via the DB-admin AppSetting layer.
  ticketing: {
    enabled: false,
    commissionBps: 0,
  },
  // ── Treasury oversight (Wave D, CLAUDE.md §7) ───────────────────────────────
  // largePayoutThresholds: only the launch fiat ships a default; every other
  // currency FAILS CLOSED (all payouts require approval) until an operator sets
  // its threshold via the DB-admin layer (treasury.largePayoutThresholds.<CODE>).
  // fiatFloatTargets: OPT-IN — every currency ships 0 (no target → always healthy)
  // so NGN behaviour is unchanged; operators set real targets per currency via the
  // DB-admin layer (treasury.fiatFloatTargets.<CODE>). lowFloatThresholdBps mirrors
  // the treasury service's in-service default (2500 bps = 25%).
  treasury: {
    largePayoutThresholds: {
      // ₦1,000,000 — the pre-Wave-D hardcoded gate, preserved as the NGN default.
      NGN: 1_000_000,
    },
    fiatFloatTargets: {
      NGN: 0,
      GHS: 0,
      KES: 0,
      UGX: 0,
      TZS: 0,
      RWF: 0,
      ZAR: 0,
      USD: 0,
    },
    lowFloatThresholdBps: 2500,
  },
  // ── Embedded agent (Phase 4 wave 2, CLAUDE.md §7) ──────────────────────────
  // enabled defaults true (current behaviour). modelId mirrors the AGENT_MODEL env
  // value (same env-derived pattern as catalog.networks.TRON.masterWalletId above)
  // so the agent behaves IDENTICALLY with no DB override. The system prompt is NOT
  // a config value (read-only, §3.1/§6); the ANTHROPIC_API_KEY stays env-only.
  agent: {
    enabled: true,
    modelId: process.env['AGENT_MODEL'] ?? 'claude-opus-4-8',
    // Single-node intent-extraction graph today → one pass per turn. Admin-tunable
    // (§7) so a future tool-call loop can raise it without a code change.
    maxToolCallsPerTurn: 1,
  },
  // ── Capability gating (Task 1.2, CLAUDE.md §7) ─────────────────────────────
  // Minimum KYC tier required to use each transactable capability. Keys mirror
  // the `catalog.capabilities` dotted leaves. Code-default now; the gate
  // (Task 1.3) reads it through EffectiveConfigService, which falls back to
  // this default until an operator registers a DB-admin override (deferred
  // follow-up — NOT part of this task).
  gating: {
    capabilityMinTier: {
      'crypto.buy': 'tier_1',
      'crypto.receive': 'tier_1',
      'crypto.sell': 'tier_2',
      'crypto.send': 'tier_2',
      'crypto.swap': 'tier_2',
    },
  },
  // ── Sumsub (real KYC provider, Task 3.2, CLAUDE.md §7) ──────────────────────
  // mockMode / baseUrl mirror env 1:1 (env-derived pattern, like
  // catalog.networks.TRON.masterWalletId / agent.modelId above). levelToTier is
  // built ONLY from level names that are actually set — filtering out undefined
  // means an absent SUMSUB_LEVEL_TIER2/3 (e.g. the current local .env, which
  // predates the level names) never produces an `undefined` map key.
  sumsub: {
    mockMode: (process.env['KYC_MOCK_MODE'] ?? 'true') !== 'false',
    baseUrl: process.env['SUMSUB_BASE_URL'] ?? 'https://api.sumsub.com',
    levelToTier: Object.fromEntries(buildSumsubLevelToTierEntries()),
  },
  // ── Onboarding (CLAUDE.md §7) ──────────────────────────────────────────────
  // The WhatsApp KYC CTA links here (joined onto WEB_APP_BASE_URL) — a token-less
  // onboarding link; the FE serves this route (OnboardingWizard at /get-started).
  onboarding: {
    webPath: '/get-started',
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
