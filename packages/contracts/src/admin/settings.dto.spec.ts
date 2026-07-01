import {
  EffectiveSettingSchema,
  EffectiveSettingListResponseSchema,
  UpdateSettingRequestSchema,
  SettingsQuerySchema,
} from "./settings.dto";

describe("EffectiveSettingSchema", () => {
  const valid = {
    key: "pricing.processingFeeBps",
    category: "Pricing",
    label: "Processing fee (bps)",
    description: "Platform processing fee.",
    valueType: "number" as const,
    editable: true,
    value: 100,
    source: "default" as const,
    scope: "global" as const,
    scopeValue: null,
  };

  it("accepts a well-formed effective setting", () => {
    expect(EffectiveSettingSchema.parse(valid)).toEqual(valid);
  });

  it("accepts any value type for the unknown value (boolean, array, string)", () => {
    expect(
      EffectiveSettingSchema.parse({
        ...valid,
        valueType: "boolean",
        value: true,
      }).value,
    ).toBe(true);
    expect(
      EffectiveSettingSchema.parse({
        ...valid,
        valueType: "string[]",
        value: ["a", "b"],
      }).value,
    ).toEqual(["a", "b"]);
  });

  it("accepts a non-null scopeValue", () => {
    expect(
      EffectiveSettingSchema.parse({ ...valid, scopeValue: "tier_1" })
        .scopeValue,
    ).toBe("tier_1");
  });

  it("rejects an invalid valueType", () => {
    expect(() =>
      EffectiveSettingSchema.parse({ ...valid, valueType: "object" }),
    ).toThrow();
  });

  it("rejects an invalid source", () => {
    expect(() =>
      EffectiveSettingSchema.parse({ ...valid, source: "cache" }),
    ).toThrow();
  });

  it("rejects an invalid scope", () => {
    expect(() =>
      EffectiveSettingSchema.parse({ ...valid, scope: "user" }),
    ).toThrow();
  });
});

describe("EffectiveSettingListResponseSchema", () => {
  it("wraps an array of settings", () => {
    const parsed = EffectiveSettingListResponseSchema.parse({ settings: [] });
    expect(parsed.settings).toEqual([]);
  });
});

describe("UpdateSettingRequestSchema", () => {
  it("defaults scope to global and scopeValue to null", () => {
    const parsed = UpdateSettingRequestSchema.parse({ value: 200 });
    expect(parsed).toEqual({ value: 200, scope: "global", scopeValue: null });
  });

  it("accepts an explicit tier scope with a scopeValue", () => {
    const parsed = UpdateSettingRequestSchema.parse({
      value: 50_000,
      scope: "tier",
      scopeValue: "tier_1",
    });
    expect(parsed).toEqual({
      value: 50_000,
      scope: "tier",
      scopeValue: "tier_1",
    });
  });

  it("rejects an invalid scope", () => {
    expect(() =>
      UpdateSettingRequestSchema.parse({ value: 1, scope: "nope" }),
    ).toThrow();
  });
});

describe("SettingsQuerySchema", () => {
  it("accepts an optional category", () => {
    expect(SettingsQuerySchema.parse({}).category).toBeUndefined();
    expect(SettingsQuerySchema.parse({ category: "Pricing" }).category).toBe(
      "Pricing",
    );
  });
});
