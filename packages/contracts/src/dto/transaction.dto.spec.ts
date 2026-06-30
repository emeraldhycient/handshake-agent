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
});
