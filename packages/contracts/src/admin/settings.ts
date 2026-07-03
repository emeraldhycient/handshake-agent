import { z } from "zod";

import { SupportedAssetSchema, KNOWN_FIAT_CURRENCIES } from "../common";

// The admin-tunable config-key registry — the SINGLE source of truth for which
// JSON/env config leaf values the admin console may override (root CLAUDE.md §7,
// DB-admin › env › JSON). Every entry mirrors a dot-path in the API's
// `AppConfig` (api/src/core/config/configuration.ts) and feeds three consumers:
// the admin UI (which form control + bounds to render), the API (which key is
// editable and how to validate a proposed value), and the EffectiveConfigService
// overlay (which keys may be applied as DB overrides).
//
// Registered keys are business-tunable leaves ONLY. Security infrastructure
// (auth.*: PIN / JWT / OTP / step-up), `DATABASE_URL`, and any secret / signing
// key are deliberately absent — those are env-only and never admin-editable.

export type SettingValueType = "number" | "string" | "boolean" | "string[]";

export type SettingScope = "global" | "tier" | "provider";

export type SettingCategory =
  | "Config"
  | "Pricing"
  | "Catalog"
  | "KYC"
  | "Compliance"
  | "Beneficiary"
  | "Tickets"
  | "Agent";

export interface SettingRegistryEntry {
  /** Full dot-path into AppConfig, e.g. "pricing.processingFeeBps". */
  key: string;
  scope: SettingScope;
  category: SettingCategory;
  editable: boolean;
  secret: boolean;
  valueType: SettingValueType;
  label: string;
  description: string;
  /** Inclusive lower bound for `number` values. */
  min?: number;
  /** Inclusive upper bound for `number` values. */
  max?: number;
  /** Allowed values for a `string` value (renders an enum/select). */
  options?: string[];
}

// Common bounds for repeated value families. A basis-points value is 0..10000
// (0%..100%); a cooling-off window is capped at 7 days (604800s).
const BPS_MIN = 0;
const BPS_MAX = 10_000;
const SECONDS_IN_A_WEEK = 604_800;
// A generous ceiling for tunable second/count/limit values so the admin UI can
// render a slider/number input without an unbounded upper edge.
const POSITIVE_INT_MAX = Number.MAX_SAFE_INTEGER;

const s = (
  key: string,
  category: SettingCategory,
  valueType: SettingValueType,
  label: string,
  description: string,
  bounds?: { min?: number; max?: number; options?: string[] },
): SettingRegistryEntry => ({
  key,
  scope: "global",
  category,
  editable: true,
  secret: false,
  valueType,
  label,
  description,
  ...(bounds?.min !== undefined ? { min: bounds.min } : {}),
  ...(bounds?.max !== undefined ? { max: bounds.max } : {}),
  ...(bounds?.options !== undefined ? { options: bounds.options } : {}),
});

const bps = (
  key: string,
  category: SettingCategory,
  label: string,
  description: string,
): SettingRegistryEntry =>
  s(key, category, "number", label, description, {
    min: BPS_MIN,
    max: BPS_MAX,
  });

const positiveInt = (
  key: string,
  category: SettingCategory,
  label: string,
  description: string,
): SettingRegistryEntry =>
  s(key, category, "number", label, description, {
    min: 0,
    max: POSITIVE_INT_MAX,
  });

const flag = (
  key: string,
  label: string,
  description: string,
  category: SettingCategory = "Catalog",
): SettingRegistryEntry => s(key, category, "boolean", label, description);

// Per-asset pricing entries (root CLAUDE.md §3.1: spreads are NEVER a line item,
// but they ARE admin-tunable). USDT/BTC/TRX are the money-path assets at launch.
const PRICED_ASSETS = ["USDT", "BTC", "TRX"] as const;

// A base rate is registered per priced asset × EVERY known fiat — not just NGN. A
// currency is fail-closed on enablement (AdminCurrencyService.assertPricingExists)
// unless a base rate keyed by its code exists on at least one priced asset, so
// without these keys a non-NGN currency could never be priced (the settings PATCH
// rejects unregistered keys) and therefore never enabled. Registering the full
// matrix is what makes "add a currency, price it, enable it" work end-to-end (§7).
const baseRate = (asset: string, code: string): SettingRegistryEntry =>
  s(
    `pricing.assets.${asset}.baseRates.${code}`,
    "Pricing",
    "number",
    `${asset} base rate (${code})`,
    `Mid-market ${code} rate per 1 ${asset}. Production replaces this with a live feed; the config value is the fallback baseline.`,
    { min: 0, max: POSITIVE_INT_MAX },
  );
const assetPricing = (asset: string): SettingRegistryEntry[] => [
  ...KNOWN_FIAT_CURRENCIES.map((code) => baseRate(asset, code)),
  bps(
    `pricing.assets.${asset}.buySpreadBps`,
    "Pricing",
    `${asset} buy spread (bps)`,
    `Platform spread folded into BUY quotes for ${asset} (marks up the rate; user receives less crypto).`,
  ),
  bps(
    `pricing.assets.${asset}.sellSpreadBps`,
    "Pricing",
    `${asset} sell spread (bps)`,
    `Platform spread folded into SELL quotes for ${asset} (marks down the rate; user receives less fiat).`,
  ),
];

// Per-asset / per-fiat catalog LIVE toggles (Phase 9). These are real config
// dot-paths — `catalog.assets.<sym>.enabled` / `catalog.fiats.<code>.enabled`
// (verified: cfg.catalog.fiats['NGN'].enabled) — that gate which assets/currencies
// can settle real transactions (root CLAUDE.md §7: flipping a flag enables a
// service without a deploy). Fail-closed: an absent flag resolves to false.
// Enumerated from the canonical contract enums so the registry never drifts from
// the SupportedAsset / FiatCurrency sets.
const assetToggle = (asset: string): SettingRegistryEntry =>
  flag(
    `catalog.assets.${asset}.enabled`,
    `Asset live: ${asset}`,
    `Enable ${asset} as a live tradeable asset (buy/sell/send/swap). Fail-closed: off means the asset is not tradeable.`,
  );
const fiatToggle = (code: string): SettingRegistryEntry =>
  flag(
    `catalog.fiats.${code}.enabled`,
    `Currency live: ${code}`,
    `Enable ${code} as a live settlement currency. Fail-closed: off means no transaction can settle in ${code}.`,
  );

// NGN KYC-tier limits (root CLAUDE.md §3.3: server-side gate). Other fiats are
// not yet live (catalog enabled:false), so only NGN is enumerated here.
const TIERS = ["tier_1", "tier_2", "tier_3"] as const;
const tierLimits = (tier: string): SettingRegistryEntry[] => [
  positiveInt(
    `limits.NGN.${tier}.perTxFiatMax`,
    "KYC",
    `NGN ${tier} per-transaction max`,
    `Maximum NGN amount per single transaction for ${tier}.`,
  ),
  positiveInt(
    `limits.NGN.${tier}.dailyFiatMax`,
    "KYC",
    `NGN ${tier} daily max`,
    `Maximum cumulative NGN amount within a rolling 24-hour window for ${tier}.`,
  ),
  positiveInt(
    `limits.NGN.${tier}.weeklyFiatMax`,
    "KYC",
    `NGN ${tier} weekly max`,
    `Maximum cumulative NGN amount within a rolling 7-day window for ${tier}.`,
  ),
  positiveInt(
    `limits.NGN.${tier}.perSendOnChainFiatMax`,
    "KYC",
    `NGN ${tier} single on-chain send max`,
    `Maximum NGN-equivalent of a single on-chain (crypto-address) send for ${tier}. On-chain sends are irreversible, so this can be set tighter than the general per-transaction cap.`,
  ),
  positiveInt(
    `limits.NGN.${tier}.dailyTxCountMax`,
    "KYC",
    `NGN ${tier} daily transaction count`,
    `Maximum number of transactions within a rolling 24-hour window for ${tier}.`,
  ),
];

export const SETTING_REGISTRY: readonly SettingRegistryEntry[] = [
  // ── Pricing ────────────────────────────────────────────────────────────────
  bps(
    "pricing.processingFeeBps",
    "Pricing",
    "Processing fee (bps)",
    "Platform processing fee applied to buy/sell orders, in basis points.",
  ),
  positiveInt(
    "pricing.expiresInSec",
    "Config",
    "Quote validity (seconds)",
    "Validity window for buy/sell quotes; the user must confirm before it expires.",
  ),
  ...PRICED_ASSETS.flatMap(assetPricing),

  // ── KYC tier limits (NGN) ───────────────────────────────────────────────────
  ...TIERS.flatMap(tierLimits),

  // ── Compliance ──────────────────────────────────────────────────────────────
  positiveInt(
    "compliance.travelRuleThresholds.NGN",
    "Compliance",
    "Travel Rule threshold (NGN)",
    "Fiat-equivalent NGN value at or above which a send proposal sets requiresTravelRule=true (CBN circular / FATF Travel Rule).",
  ),
  // The sanctions denylist is edited via the existing /admin/settings API (no new
  // endpoint): a string[] of addresses/identifiers blocked by sanctions screening.
  s(
    "compliance.sanctionsDenylist",
    "Compliance",
    "string[]",
    "Sanctions denylist",
    "Addresses/identifiers blocked by sanctions screening.",
    { min: 0, max: 0 },
  ),

  // ── Catalog capability flags (fail-closed: absent === false) ────────────────
  flag(
    "catalog.capabilities.crypto.buy",
    "Capability: crypto buy",
    "Enable the buy-crypto-for-fiat flow.",
  ),
  flag(
    "catalog.capabilities.crypto.sell",
    "Capability: crypto sell",
    "Enable the sell-crypto-for-fiat flow.",
  ),
  flag(
    "catalog.capabilities.crypto.send",
    "Capability: crypto send",
    "Enable on-chain crypto sends to beneficiaries.",
  ),
  flag(
    "catalog.capabilities.crypto.receive",
    "Capability: crypto receive",
    "Enable receiving crypto into a user wallet address.",
  ),
  flag(
    "catalog.capabilities.crypto.swap",
    "Capability: crypto swap",
    "Enable asset-to-asset swaps (requires >=2 enabled assets).",
  ),
  positiveInt(
    "catalog.sendQuoteExpiresInSec",
    "Catalog",
    "Send quote validity (seconds)",
    "Validity window for send quotes; the user must confirm before it expires.",
  ),

  // ── Catalog asset / fiat live toggles (Phase 9; fail-closed) ────────────────
  ...SupportedAssetSchema.options.map(assetToggle),
  ...KNOWN_FIAT_CURRENCIES.map(fiatToggle),

  // ── Beneficiary ─────────────────────────────────────────────────────────────
  s(
    "beneficiary.cryptoCoolingOffSeconds",
    "Beneficiary",
    "number",
    "Crypto cooling-off (seconds)",
    "Cooling-off window before a newly-added crypto-address beneficiary can receive funds (IDN-08).",
    { min: 0, max: SECONDS_IN_A_WEEK },
  ),

  // ── Execution / drift / spread (Config) ─────────────────────────────────────
  bps(
    "buy.maxDriftBps",
    "Config",
    "Buy max FX drift (bps)",
    "Maximum allowed FX-rate drift between the original buy quote and the re-quote at execution.",
  ),
  bps(
    "sell.maxDriftBps",
    "Config",
    "Sell max FX drift (bps)",
    "Maximum allowed FX-rate drift between the original sell quote and the re-quote at execution.",
  ),
  bps(
    "swap.maxDriftBps",
    "Config",
    "Swap max drift (bps)",
    "Maximum allowed swap-rate drift between the stored proposal quote and the re-quote at execution.",
  ),
  bps(
    "swap.spreadBps",
    "Config",
    "Swap spread (bps)",
    "Platform spread folded into the displayed swap rate (never a separate line item).",
  ),

  // ── Directive ───────────────────────────────────────────────────────────────
  positiveInt(
    "directive.ttlSeconds",
    "Config",
    "Directive TTL (seconds)",
    "Time-to-live for a DirectiveGrant before it expires and can no longer be consumed.",
  ),

  // ── Settlement reconciliation ───────────────────────────────────────────────
  positiveInt(
    "reconciliation.gracePeriodSec",
    "Config",
    "Reconciliation grace period (seconds)",
    "Only re-drive settlement for outbox rows older than this, to avoid racing in-flight webhooks.",
  ),
  positiveInt(
    "reconciliation.batchSize",
    "Config",
    "Reconciliation batch size",
    "Maximum number of outbox rows the reconciliation cron processes per tick.",
  ),

  // ── Statement / transaction history ─────────────────────────────────────────
  positiveInt(
    "statement.linkTtlSeconds",
    "Config",
    "Statement link TTL (seconds)",
    "Validity window for a signed statement download link.",
  ),
  positiveInt(
    "statement.maxWindowDays",
    "Config",
    "Statement max window (days)",
    "Maximum history window in days; longer requests are clamped.",
  ),
  positiveInt(
    "statement.rowCap",
    "Config",
    "Statement row cap",
    "Maximum rows returned to the statement / chat card before truncation is surfaced.",
  ),
  positiveInt(
    "statement.timezoneOffsetMinutes",
    "Config",
    "Statement timezone offset (minutes)",
    "Fixed offset in minutes for local day boundaries (WAT = UTC+1, no DST => 60).",
  ),

  // ── Tickets (Phase 4 wave 2) ─────────────────────────────────────────────────
  // Enablement flag + platform commission for the ticketing vertical. The flag is
  // fail-closed (default off); flipping it enables the vertical without a deploy (§7).
  flag(
    "ticketing.enabled",
    "Tickets enabled",
    "Enable the event-ticketing vertical (discover + buy tickets).",
    "Tickets",
  ),
  bps(
    "ticketing.commissionBps",
    "Tickets",
    "Ticketing commission (bps)",
    "Handshake platform commission per ticket order, in basis points.",
  ),

  // ── Agent (Phase 4 wave 2) ───────────────────────────────────────────────────
  // The embedded LangGraph agent's enablement flag + model id are admin-tunable
  // (§7). When disabled, AgentService throws AgentUnavailableError before any LLM
  // call. The SYSTEM PROMPT is intentionally NOT registered — it is read-only and
  // never editable (§3.1/§6); the ANTHROPIC_API_KEY is a secret and stays env-only.
  flag(
    "agent.enabled",
    "Agent enabled",
    "Enable the embedded NLU agent (intent extraction). When off, the assistant is unavailable.",
    "Agent",
  ),
  s(
    "agent.modelId",
    "Agent",
    "string",
    "Agent model id",
    "The Anthropic model id the agent uses for intent extraction (e.g. claude-opus-4-8).",
  ),
];

const REGISTRY_BY_KEY = new Map<string, SettingRegistryEntry>(
  SETTING_REGISTRY.map((e) => [e.key, e]),
);

/**
 * Build the runtime validator for a registered config key. The admin console
 * proposes a value; the API parses it through this schema before writing the
 * AppSetting row, so an out-of-range or wrong-typed override never reaches the
 * EffectiveConfigService overlay. Throws if `key` is not in the registry.
 */
export function settingSchemaFor(key: string): z.ZodTypeAny {
  const e = REGISTRY_BY_KEY.get(key);
  if (!e) throw new Error(`Unknown config key: ${key}`);

  switch (e.valueType) {
    case "number": {
      let schema = z.number();
      if (e.min !== undefined) schema = schema.min(e.min);
      if (e.max !== undefined) schema = schema.max(e.max);
      return schema;
    }
    case "boolean":
      return z.boolean();
    case "string":
      return e.options && e.options.length > 0
        ? z.enum(e.options as [string, ...string[]])
        : z.string();
    case "string[]":
      return z.array(z.string());
  }
}
