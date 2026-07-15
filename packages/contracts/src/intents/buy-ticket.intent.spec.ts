/**
 * Parse fixtures for BuyTicketIntentSchema — the free-text ticketing-search
 * intent the NLU layer emits, plus its narrowing through the root IntentSchema
 * discriminated union. The engine resolves the query to a concrete event and
 * seat tier before any purchase (§3.1); this pins the emitted-intent contract.
 */

import { BuyTicketIntentSchema } from "./buy-ticket.intent";
import { IntentSchema } from "./index";

describe("BuyTicketIntentSchema", () => {
  it("parses a valid buy_ticket intent", () => {
    const result = BuyTicketIntentSchema.parse({
      action: "buy_ticket",
      query: "Burna Boy Lagos December",
    });
    expect(result.action).toBe("buy_ticket");
    expect(result.query).toBe("Burna Boy Lagos December");
  });

  it("accepts a query of exactly 200 characters", () => {
    const result = BuyTicketIntentSchema.parse({
      action: "buy_ticket",
      query: "a".repeat(200),
    });
    expect(result.query).toHaveLength(200);
  });

  it("rejects an empty query", () => {
    expect(() =>
      BuyTicketIntentSchema.parse({ action: "buy_ticket", query: "" }),
    ).toThrow();
  });

  it("rejects a missing query", () => {
    expect(() =>
      BuyTicketIntentSchema.parse({ action: "buy_ticket" }),
    ).toThrow();
  });

  it("rejects a query longer than 200 characters", () => {
    expect(() =>
      BuyTicketIntentSchema.parse({
        action: "buy_ticket",
        query: "a".repeat(201),
      }),
    ).toThrow();
  });

  it("rejects the wrong action literal", () => {
    expect(() =>
      BuyTicketIntentSchema.parse({ action: "buy_crypto", query: "concert" }),
    ).toThrow();
  });
});

describe("IntentSchema — buy_ticket union narrowing", () => {
  it("parses a buy_ticket intent through the root union and narrows on action", () => {
    const intent = IntentSchema.parse({
      action: "buy_ticket",
      query: "Afrobeats festival tickets",
    });
    if (intent.action === "buy_ticket") {
      // TypeScript should narrow; query must be accessible here.
      expect(intent.query).toBe("Afrobeats festival tickets");
    } else {
      throw new Error("Expected buy_ticket action");
    }
  });
});
