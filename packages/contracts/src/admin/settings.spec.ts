import { z } from "zod";

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
