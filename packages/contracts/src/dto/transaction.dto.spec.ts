import { describe, it, expect } from "vitest";
import { TransactionListResponseSchema } from "./transaction.dto";

describe("TransactionListResponseSchema", () => {
  it("parses a list with minimal + full items", () => {
    const ok = {
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          type: "buy",
          status: "completed",
          asset: "USDT",
          cryptoAmount: "29.97",
          fiatAmount: "50000",
          fiatCurrency: "NGN",
          createdAt: "2026-06-29T12:00:00.000Z",
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          type: "send",
          status: "settling",
          counterparty: "TQn9...gk7r",
          createdAt: "2026-06-29T11:00:00.000Z",
        },
      ],
      nextCursor: "2026-06-29T11:00:00.000Z",
    };
    expect(TransactionListResponseSchema.parse(ok)).toEqual(ok);
  });
  it("allows an empty list with no cursor", () => {
    expect(TransactionListResponseSchema.parse({ items: [] })).toEqual({
      items: [],
    });
  });
  it("accepts an optional per-row direction ('in' | 'out')", () => {
    const withDirection = {
      items: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          type: "internal_transfer",
          status: "completed",
          asset: "USDT",
          cryptoAmount: "3",
          direction: "in" as const,
          counterparty: "@ada",
          createdAt: "2026-07-15T10:00:00.000Z",
        },
      ],
    };
    expect(TransactionListResponseSchema.parse(withDirection)).toEqual(
      withDirection,
    );
  });
  it("rejects a direction outside the 'in' | 'out' enum", () => {
    const bad = {
      items: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          type: "buy",
          status: "completed",
          direction: "sideways",
          createdAt: "2026-07-15T10:00:00.000Z",
        },
      ],
    };
    expect(TransactionListResponseSchema.safeParse(bad).success).toBe(false);
  });
});
