/**
 * Parse fixtures for BuyCryptoIntentSchema and NoIntentSchema — the buy-vertical
 * and clarification-fallback intents the NLU layer emits, plus their narrowing
 * through the root IntentSchema discriminated union.
 *
 * `buy-crypto.intent` is the reference pattern (schema + z.infer type + parse
 * fixtures) named in packages/contracts/CLAUDE.md; this pins the contract that
 * a model-emitted intent must satisfy before the deterministic engine acts (§3.1).
 */

import { BuyCryptoIntentSchema, NoIntentSchema } from "./buy-crypto.intent";
import { IntentSchema } from "./index";

describe("BuyCryptoIntentSchema", () => {
  it("parses a valid buy_crypto intent", () => {
    const result = BuyCryptoIntentSchema.parse({
      action: "buy_crypto",
      asset: "USDT",
      fiatAmount: "5000",
      fiatCurrency: "NGN",
    });
    expect(result.action).toBe("buy_crypto");
    expect(result.asset).toBe("USDT");
    expect(result.fiatAmount).toBe("5000");
    expect(result.fiatCurrency).toBe("NGN");
  });

  it("defaults fiatCurrency to NGN when omitted", () => {
    const result = BuyCryptoIntentSchema.parse({
      action: "buy_crypto",
      asset: "USDT",
      fiatAmount: "1000",
    });
    expect(result.fiatCurrency).toBe("NGN");
  });

  it("accepts a fiatAmount with up to 2 decimal places", () => {
    const result = BuyCryptoIntentSchema.parse({
      action: "buy_crypto",
      asset: "USDT",
      fiatAmount: "1000.50",
      fiatCurrency: "NGN",
    });
    expect(result.fiatAmount).toBe("1000.50");
  });

  it("accepts every supported asset (USDT, BTC, TRX)", () => {
    for (const asset of ["USDT", "BTC", "TRX"] as const) {
      const result = BuyCryptoIntentSchema.parse({
        action: "buy_crypto",
        asset,
        fiatAmount: "100",
        fiatCurrency: "NGN",
      });
      expect(result.asset).toBe(asset);
    }
  });

  it("accepts any well-formed 3-letter fiatCurrency (catalog-driven, server re-validates)", () => {
    // The schema is deliberately permissive on currency: the money-path boundary
    // re-checks it against the live catalog (§3.3), not this enum.
    const result = BuyCryptoIntentSchema.parse({
      action: "buy_crypto",
      asset: "USDT",
      fiatAmount: "100",
      fiatCurrency: "GHS",
    });
    expect(result.fiatCurrency).toBe("GHS");
  });

  it("trims surrounding whitespace on fiatCurrency", () => {
    const result = BuyCryptoIntentSchema.parse({
      action: "buy_crypto",
      asset: "USDT",
      fiatAmount: "100",
      fiatCurrency: "  GHS  ",
    });
    expect(result.fiatCurrency).toBe("GHS");
  });

  it("rejects an unknown asset", () => {
    expect(() =>
      BuyCryptoIntentSchema.parse({
        action: "buy_crypto",
        asset: "ETH",
        fiatAmount: "100",
        fiatCurrency: "NGN",
      }),
    ).toThrow();
  });

  it("rejects a fiatAmount with more than 2 decimal places", () => {
    expect(() =>
      BuyCryptoIntentSchema.parse({
        action: "buy_crypto",
        asset: "USDT",
        fiatAmount: "10.123", // 3 d.p. — violates FiatAmountSchema
        fiatCurrency: "NGN",
      }),
    ).toThrow();
  });

  it("rejects a non-numeric fiatAmount", () => {
    expect(() =>
      BuyCryptoIntentSchema.parse({
        action: "buy_crypto",
        asset: "USDT",
        fiatAmount: "abc",
        fiatCurrency: "NGN",
      }),
    ).toThrow();
  });

  it("rejects a missing fiatAmount", () => {
    expect(() =>
      BuyCryptoIntentSchema.parse({
        action: "buy_crypto",
        asset: "USDT",
        fiatCurrency: "NGN",
      }),
    ).toThrow();
  });

  it("rejects a lowercase fiatCurrency code", () => {
    expect(() =>
      BuyCryptoIntentSchema.parse({
        action: "buy_crypto",
        asset: "USDT",
        fiatAmount: "100",
        fiatCurrency: "ngn", // must be 3-letter UPPERCASE
      }),
    ).toThrow();
  });

  it("rejects the wrong action literal", () => {
    expect(() =>
      BuyCryptoIntentSchema.parse({
        action: "sell_crypto",
        asset: "USDT",
        fiatAmount: "100",
        fiatCurrency: "NGN",
      }),
    ).toThrow();
  });
});

describe("NoIntentSchema", () => {
  it("parses a valid none intent with a clarification", () => {
    const result = NoIntentSchema.parse({
      action: "none",
      clarification: "Which asset would you like to buy?",
    });
    expect(result.action).toBe("none");
    expect(result.clarification).toBe("Which asset would you like to buy?");
  });

  it("accepts a clarification of exactly 500 characters", () => {
    const result = NoIntentSchema.parse({
      action: "none",
      clarification: "a".repeat(500),
    });
    expect(result.clarification).toHaveLength(500);
  });

  it("rejects an empty clarification", () => {
    expect(() =>
      NoIntentSchema.parse({ action: "none", clarification: "" }),
    ).toThrow();
  });

  it("rejects a missing clarification", () => {
    expect(() => NoIntentSchema.parse({ action: "none" })).toThrow();
  });

  it("rejects a clarification longer than 500 characters", () => {
    expect(() =>
      NoIntentSchema.parse({ action: "none", clarification: "a".repeat(501) }),
    ).toThrow();
  });

  it("rejects the wrong action literal", () => {
    expect(() =>
      NoIntentSchema.parse({ action: "buy_crypto", clarification: "hi" }),
    ).toThrow();
  });
});

describe("IntentSchema — buy_crypto and none union narrowing", () => {
  it("parses a buy_crypto intent through the root union and narrows on action", () => {
    const intent = IntentSchema.parse({
      action: "buy_crypto",
      asset: "USDT",
      fiatAmount: "2500",
      fiatCurrency: "NGN",
    });
    if (intent.action === "buy_crypto") {
      // TypeScript should narrow; asset/fiatAmount must be accessible here.
      expect(intent.asset).toBe("USDT");
      expect(intent.fiatAmount).toBe("2500");
    } else {
      throw new Error("Expected buy_crypto action");
    }
  });

  it("parses a none intent through the root union and narrows on action", () => {
    const intent = IntentSchema.parse({
      action: "none",
      clarification: "Did you mean buy or sell?",
    });
    if (intent.action === "none") {
      expect(intent.clarification).toBe("Did you mean buy or sell?");
    } else {
      throw new Error("Expected none action");
    }
  });
});
