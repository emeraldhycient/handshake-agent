import { z } from "zod";

import { SupportedAssetSchema, KNOWN_FIAT_CURRENCIES } from "../common";
import {
  SETTING_REGISTRY,
  settingSchemaFor,
  type SettingRegistryEntry,
} from "./settings";

const SETTING_CATEGORIES = [
  "Config",
  "Pricing",
  "Catalog",
  "KYC",
  "Compliance",
  "Beneficiary",
  "Tickets",
  "Agent",
] as const;
const SETTING_SCOPES = ["global", "tier", "provider"] as const;
const SETTING_VALUE_TYPES = [
  "number",
  "string",
  "boolean",
  "string[]",
] as const;

function entry(key: string): SettingRegistryEntry {
  const found = SETTING_REGISTRY.find((e) => e.key === key);
  if (!found) throw new Error(`missing registry key: ${key}`);
  return found;
}

describe("SETTING_REGISTRY", () => {
  it("is non-empty and every entry is well-formed", () => {
    expect(SETTING_REGISTRY.length).toBeGreaterThan(0);
    for (const e of SETTING_REGISTRY) {
      expect(e.key.length).toBeGreaterThan(0);
      expect(SETTING_SCOPES).toContain(e.scope);
      expect(SETTING_CATEGORIES).toContain(e.category);
      expect(SETTING_VALUE_TYPES).toContain(e.valueType);
      expect(typeof e.editable).toBe("boolean");
      expect(typeof e.secret).toBe("boolean");
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate keys", () => {
    const keys = SETTING_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("registers all of every money-path tunable family expected", () => {
    const keys = new Set(SETTING_REGISTRY.map((e) => e.key));
    expect(keys.has("pricing.processingFeeBps")).toBe(true);
    expect(keys.has("pricing.assets.USDT.buySpreadBps")).toBe(true);
    expect(keys.has("limits.NGN.tier_1.perTxFiatMax")).toBe(true);
    expect(keys.has("compliance.travelRuleThresholds.NGN")).toBe(true);
    expect(keys.has("catalog.capabilities.crypto.buy")).toBe(true);
    expect(keys.has("beneficiary.cryptoCoolingOffSeconds")).toBe(true);
  });

  it("registers a weekly-max cap per tier (rolling 7-day fiat cap, enforced server-side)", () => {
    for (const tier of ["tier_1", "tier_2", "tier_3"] as const) {
      const e = entry(`limits.NGN.${tier}.weeklyFiatMax`);
      expect(e.category).toBe("KYC");
      expect(e.valueType).toBe("number");
      expect(e.editable).toBe(true);
      expect(e.min).toBe(0);
    }
  });

  it("registers a per-send on-chain cap per tier (single on-chain send max, enforced server-side)", () => {
    for (const tier of ["tier_1", "tier_2", "tier_3"] as const) {
      const e = entry(`limits.NGN.${tier}.perSendOnChainFiatMax`);
      expect(e.category).toBe("KYC");
      expect(e.valueType).toBe("number");
      expect(e.editable).toBe(true);
      expect(e.min).toBe(0);
    }
  });

  it("registers the tier-change cooling-off (seconds, enforced server-side)", () => {
    const e = entry("compliance.tierChangeCoolingOffSeconds");
    expect(e.category).toBe("Compliance");
    expect(e.valueType).toBe("number");
    expect(e.editable).toBe(true);
    expect(e.min).toBe(0);
  });

  it("registers the full tier-limit family for EVERY known fiat, not just NGN", () => {
    const FIELDS = [
      "perTxFiatMax",
      "dailyFiatMax",
      "weeklyFiatMax",
      "perSendOnChainFiatMax",
      "sendsPer10MinMax",
      "dailyTxCountMax",
    ];
    for (const code of KNOWN_FIAT_CURRENCIES) {
      for (const tier of ["tier_1", "tier_2", "tier_3"]) {
        for (const field of FIELDS) {
          const e = entry(`limits.${code}.${tier}.${field}`);
          expect(e.category).toBe("KYC");
          expect(e.valueType).toBe("number");
          expect(e.editable).toBe(true);
          expect(e.min).toBe(0);
        }
      }
    }
  });

  it("registers a rolling 10-minute send-count cap per tier (enforced server-side)", () => {
    for (const tier of ["tier_1", "tier_2", "tier_3"] as const) {
      const e = entry(`limits.NGN.${tier}.sendsPer10MinMax`);
      expect(e.category).toBe("KYC");
      expect(e.valueType).toBe("number");
      expect(e.editable).toBe(true);
      expect(e.min).toBe(0);
    }
  });

  it("registers the Tickets enablement + commission tunables (Phase 4 wave 2)", () => {
    const enabled = entry("ticketing.enabled");
    expect(enabled.category).toBe("Tickets");
    expect(enabled.valueType).toBe("boolean");
    expect(enabled.editable).toBe(true);
    expect(enabled.secret).toBe(false);

    const commission = entry("ticketing.commissionBps");
    expect(commission.category).toBe("Tickets");
    expect(commission.valueType).toBe("number");
    expect(commission.min).toBe(0);
    expect(commission.max).toBe(10_000);
  });

  it("registers the Agent enablement + model-id tunables, never the system prompt or api key (Phase 4 wave 2)", () => {
    const enabled = entry("agent.enabled");
    expect(enabled.category).toBe("Agent");
    expect(enabled.valueType).toBe("boolean");

    const modelId = entry("agent.modelId");
    expect(modelId.category).toBe("Agent");
    expect(modelId.valueType).toBe("string");
    expect(modelId.editable).toBe(true);
    expect(modelId.secret).toBe(false);

    // The system prompt and the Anthropic API key are NEVER admin-editable (§3.1/§6).
    const keys = SETTING_REGISTRY.map((e) => e.key);
    expect(keys).not.toContain("agent.systemPrompt");
    expect(keys.some((k) => k.toLowerCase().includes("anthropic"))).toBe(false);
    expect(keys.some((k) => k.toLowerCase().includes("api_key"))).toBe(false);
  });

  it("registers a catalog live-toggle for every SupportedAsset (Phase 9)", () => {
    for (const sym of SupportedAssetSchema.options) {
      const e = entry(`catalog.assets.${sym}.enabled`);
      expect(e.category).toBe("Catalog");
      expect(e.valueType).toBe("boolean");
      expect(e.editable).toBe(true);
      expect(e.secret).toBe(false);
    }
  });

  it("registers a catalog live-toggle for every FiatCurrency (Phase 9)", () => {
    for (const code of KNOWN_FIAT_CURRENCIES) {
      const e = entry(`catalog.fiats.${code}.enabled`);
      expect(e.category).toBe("Catalog");
      expect(e.valueType).toBe("boolean");
      expect(e.editable).toBe(true);
      expect(e.secret).toBe(false);
    }
  });

  it("registers a base-rate key for every priced asset × known fiat (a currency must be priceable to be enabled)", () => {
    const PRICED = ["USDT", "BTC", "TRX"] as const;
    for (const asset of PRICED) {
      for (const code of KNOWN_FIAT_CURRENCIES) {
        const e = entry(`pricing.assets.${asset}.baseRates.${code}`);
        expect(e.category).toBe("Pricing");
        expect(e.valueType).toBe("number");
        expect(e.editable).toBe(true);
        expect(e.min).toBe(0);
      }
    }
  });

  it("builds a base-rate number schema for a non-NGN currency (accepts a positive rate, rejects negatives)", () => {
    const schema = settingSchemaFor("pricing.assets.USDT.baseRates.GHS");
    expect(schema.parse(19)).toBe(19);
    expect(() => schema.parse(-1)).toThrow();
  });

  it("builds a boolean schema for a catalog asset/fiat toggle (Phase 9)", () => {
    const assetSchema = settingSchemaFor("catalog.assets.USDT.enabled");
    expect(assetSchema.parse(true)).toBe(true);
    expect(() => assetSchema.parse("yes")).toThrow();

    const fiatSchema = settingSchemaFor("catalog.fiats.NGN.enabled");
    expect(fiatSchema.parse(false)).toBe(false);
    expect(() => fiatSchema.parse(0)).toThrow();
  });

  it("registers a large-payout approval threshold for EVERY known fiat (treasury ops gate)", () => {
    for (const code of KNOWN_FIAT_CURRENCIES) {
      const e = entry(`treasury.largePayoutThresholds.${code}`);
      expect(e.category).toBe("Config");
      expect(e.valueType).toBe("number");
      expect(e.editable).toBe(true);
      expect(e.min).toBe(0);
    }
  });

  it("registers a per-currency float target for EVERY known fiat (treasury float health)", () => {
    for (const code of KNOWN_FIAT_CURRENCIES) {
      const e = entry(`treasury.fiatFloatTargets.${code}`);
      expect(e.category).toBe("Config");
      expect(e.valueType).toBe("number");
      expect(e.editable).toBe(true);
      expect(e.min).toBe(0);
    }
  });

  it("registers the low-float threshold as a bounded bps value", () => {
    const e = entry("treasury.lowFloatThresholdBps");
    expect(e.category).toBe("Config");
    expect(e.valueType).toBe("number");
    expect(e.editable).toBe(true);
    expect(e.min).toBe(0);
    expect(e.max).toBe(10_000);
  });

  it("builds a bounded bps schema for the low-float threshold (rejects >100%)", () => {
    const schema = settingSchemaFor("treasury.lowFloatThresholdBps");
    expect(schema.parse(2500)).toBe(2500);
    expect(() => schema.parse(-1)).toThrow();
    expect(() => schema.parse(10_001)).toThrow();
  });

  it("registers the sanctions denylist as a Compliance string[] (Phase 3C)", () => {
    const denylist = entry("compliance.sanctionsDenylist");
    expect(denylist.category).toBe("Compliance");
    expect(denylist.valueType).toBe("string[]");
    expect(denylist.editable).toBe(true);
    expect(denylist.secret).toBe(false);
  });

  it("never registers security-infra (auth.*) or secret keys", () => {
    for (const e of SETTING_REGISTRY) {
      expect(e.key.startsWith("auth.")).toBe(false);
      expect(e.secret).toBe(false);
      expect(e.key.endsWith("_SECRET")).toBe(false);
    }
  });

  it("categorizes the money path correctly", () => {
    expect(entry("pricing.processingFeeBps").category).toBe("Pricing");
    expect(entry("pricing.assets.USDT.buySpreadBps").category).toBe("Pricing");
    expect(entry("limits.NGN.tier_1.perTxFiatMax").category).toBe("KYC");
    expect(entry("compliance.travelRuleThresholds.NGN").category).toBe(
      "Compliance",
    );
    expect(entry("catalog.capabilities.crypto.buy").category).toBe("Catalog");
    expect(entry("beneficiary.cryptoCoolingOffSeconds").category).toBe(
      "Beneficiary",
    );
  });

  it("registers every entry as editable, non-secret, global scope", () => {
    for (const e of SETTING_REGISTRY) {
      expect(e.editable).toBe(true);
      expect(e.secret).toBe(false);
      expect(e.scope).toBe("global");
    }
  });
});

describe("settingSchemaFor", () => {
  it("builds a bounded number schema for a bps value (accepts 150, rejects -1 and 99999)", () => {
    const schema = settingSchemaFor("pricing.processingFeeBps");
    expect(schema.parse(150)).toBe(150);
    expect(() => schema.parse(-1)).toThrow();
    expect(() => schema.parse(99999)).toThrow();
  });

  it("builds a boolean schema for a capability flag (accepts true/false, rejects 'yes')", () => {
    const schema = settingSchemaFor("catalog.capabilities.crypto.buy");
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
    expect(() => schema.parse("yes")).toThrow();
  });

  it("builds a positive-int schema for a tier limit", () => {
    const schema = settingSchemaFor("limits.NGN.tier_1.perTxFiatMax");
    expect(schema.parse(50_000)).toBe(50_000);
    expect(() => schema.parse(-5)).toThrow();
  });

  it("builds an array-of-strings schema for the sanctions denylist", () => {
    const schema = settingSchemaFor("compliance.sanctionsDenylist");
    expect(schema.parse(["addr1", "addr2"])).toEqual(["addr1", "addr2"]);
    expect(schema.parse([])).toEqual([]);
    expect(() => schema.parse("not-an-array")).toThrow();
    expect(() => schema.parse([1, 2])).toThrow();
  });

  it("throws for an unknown key", () => {
    expect(() => settingSchemaFor("not.a.real.key")).toThrow();
  });

  it("returns a zod schema for every registry entry", () => {
    for (const e of SETTING_REGISTRY) {
      expect(settingSchemaFor(e.key)).toBeInstanceOf(z.ZodType);
    }
  });
});
