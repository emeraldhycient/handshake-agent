import { CreateBuyOrderResponseSchema } from "./buy-order.dto";

describe("CreateBuyOrderResponseSchema", () => {
  it("carries fiatCurrency so the order response threads the currency", () => {
    const parsed = CreateBuyOrderResponseSchema.parse({
      orderId: "11111111-1111-1111-1111-111111111111",
      status: "pending",
      asset: "USDT",
      fiatCurrency: "NGN",
      cryptoAmount: "3.06",
      createdAt: "2026-06-25T00:00:00.000Z",
    });
    expect(parsed.fiatCurrency).toBe("NGN");
  });

  it("rejects a response missing fiatCurrency", () => {
    expect(() =>
      CreateBuyOrderResponseSchema.parse({
        orderId: "11111111-1111-1111-1111-111111111111",
        status: "pending",
        asset: "USDT",
        cryptoAmount: "3.06",
        createdAt: "2026-06-25T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
