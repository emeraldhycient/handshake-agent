import { PublicConfigResponseSchema } from "./config.dto";

describe("PublicConfigResponseSchema", () => {
  it("parses a non-secret public config payload", () => {
    const parsed = PublicConfigResponseSchema.parse({
      fiats: [{ code: "NGN", displayName: "Naira", symbol: "₦", decimals: 2 }],
      assets: [
        { symbol: "USDT", displayName: "USDT", decimals: 6, networks: ["TRON"] },
      ],
      networks: [{ id: "TRON", displayName: "TRON (TRC-20)" }],
      capabilities: { "crypto.buy": true, "crypto.swap": false },
    });
    expect(parsed.fiats[0].symbol).toBe("₦");
  });

  it("parses multiple fiats, assets, and networks", () => {
    const parsed = PublicConfigResponseSchema.parse({
      fiats: [
        { code: "NGN", displayName: "Naira", symbol: "₦", decimals: 2 },
        { code: "USD", displayName: "US Dollar", symbol: "$", decimals: 2 },
      ],
      assets: [
        { symbol: "USDT", displayName: "USDT", decimals: 6, networks: ["TRON", "BSC"] },
        { symbol: "USDC", displayName: "USDC", decimals: 6, networks: ["BSC"] },
      ],
      networks: [
        { id: "TRON", displayName: "TRON (TRC-20)" },
        { id: "BSC", displayName: "BNB Smart Chain" },
      ],
      capabilities: { "crypto.buy": true, "crypto.sell": true, "crypto.swap": false, "ticketing": true },
    });
    expect(parsed.fiats).toHaveLength(2);
    expect(parsed.assets[0].networks).toContain("BSC");
    expect(parsed.capabilities["crypto.sell"]).toBe(true);
  });

  it("rejects a payload missing the required 'fiats' field", () => {
    expect(() =>
      PublicConfigResponseSchema.parse({
        assets: [{ symbol: "USDT", displayName: "USDT", decimals: 6, networks: ["TRON"] }],
        networks: [{ id: "TRON", displayName: "TRON (TRC-20)" }],
        capabilities: { "crypto.buy": true },
      }),
    ).toThrow();
  });

  it("rejects a fiat entry missing a required field", () => {
    expect(() =>
      PublicConfigResponseSchema.parse({
        fiats: [{ code: "NGN", displayName: "Naira", decimals: 2 }], // missing symbol
        assets: [],
        networks: [],
        capabilities: {},
      }),
    ).toThrow();
  });

  it("rejects non-boolean capability values", () => {
    expect(() =>
      PublicConfigResponseSchema.parse({
        fiats: [],
        assets: [],
        networks: [],
        capabilities: { "crypto.buy": "yes" }, // string instead of boolean
      }),
    ).toThrow();
  });
});
