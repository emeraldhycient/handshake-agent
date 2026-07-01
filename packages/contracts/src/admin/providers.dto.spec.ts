import {
  ProviderCardViewSchema,
  ProviderReadinessItemSchema,
  ProviderRegistryStatusEnum,
  ProviderRegistryViewSchema,
} from "./providers.dto";

describe("ProviderRegistryStatusEnum", () => {
  it("accepts the four posture-derived statuses", () => {
    for (const s of ["ok", "degraded", "down", "mock"]) {
      expect(ProviderRegistryStatusEnum.parse(s)).toBe(s);
    }
  });

  it("rejects an unknown status", () => {
    expect(() => ProviderRegistryStatusEnum.parse("unknown")).toThrow();
  });
});

describe("ProviderCardViewSchema", () => {
  const valid = {
    key: "blockradar",
    name: "Blockradar",
    kind: "Custodial crypto WaaS · TRON",
    status: "ok",
    mock: false,
    hasSecret: true,
    capabilities: ["crypto.buy", "crypto.sell", "crypto.send", "crypto.swap"],
    latencyMs: null,
  };

  it("accepts a well-formed provider card", () => {
    expect(ProviderCardViewSchema.parse(valid)).toEqual(valid);
  });

  it("requires hasSecret + mock to be booleans", () => {
    expect(() =>
      ProviderCardViewSchema.parse({ ...valid, hasSecret: "yes" }),
    ).toThrow();
    expect(() => ProviderCardViewSchema.parse({ ...valid, mock: 1 })).toThrow();
  });

  it("accepts a numeric latency when a probe supplies one", () => {
    expect(
      ProviderCardViewSchema.parse({ ...valid, latencyMs: 120 }).latencyMs,
    ).toBe(120);
  });

  it("requires capabilities to be a string array", () => {
    expect(() =>
      ProviderCardViewSchema.parse({ ...valid, capabilities: "crypto.buy" }),
    ).toThrow();
  });

  it("rejects a missing field", () => {
    const { name: _omit, ...rest } = valid;
    expect(() => ProviderCardViewSchema.parse(rest)).toThrow();
  });
});

describe("ProviderReadinessItemSchema", () => {
  const valid = {
    key: "mock-off",
    label: "PAYMENTS_MOCK_MODE / WALLET_MOCK_MODE flipped to false",
    done: true,
  };

  it("accepts a well-formed readiness item", () => {
    expect(ProviderReadinessItemSchema.parse(valid)).toEqual(valid);
  });

  it("requires done to be a boolean", () => {
    expect(() =>
      ProviderReadinessItemSchema.parse({ ...valid, done: "true" }),
    ).toThrow();
  });
});

describe("ProviderRegistryViewSchema", () => {
  it("accepts a composite view of cards + readiness", () => {
    const view = {
      providers: [
        {
          key: "resend",
          name: "Resend",
          kind: "Transactional email",
          status: "mock",
          mock: true,
          hasSecret: false,
          capabilities: ["email"],
          latencyMs: null,
        },
      ],
      readiness: [{ key: "swap", label: "Swap route enrolled", done: false }],
    };
    expect(ProviderRegistryViewSchema.parse(view)).toEqual(view);
  });

  it("rejects when a nested card is malformed", () => {
    expect(() =>
      ProviderRegistryViewSchema.parse({
        providers: [{ key: "x" }],
        readiness: [],
      }),
    ).toThrow();
  });
});
