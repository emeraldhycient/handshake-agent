import { describe, it, expect } from "vitest";
import {
  WalletBalancesResponseSchema,
  DepositAddressResponseSchema,
} from "./wallet.dto";

describe("WalletBalancesResponseSchema", () => {
  it("parses a valid balances payload", () => {
    const ok = {
      fiatCurrency: "NGN",
      totalFiatValue: "49150.00",
      assets: [
        {
          symbol: "USDT",
          displayName: "Tether USD",
          network: "TRON",
          amount: "29.97",
          decimals: 6,
          fiatValue: "49150.00",
        },
      ],
    };
    expect(WalletBalancesResponseSchema.parse(ok)).toEqual(ok);
  });
  it("rejects a non-2dp fiat total", () => {
    expect(() =>
      WalletBalancesResponseSchema.parse({
        fiatCurrency: "NGN",
        totalFiatValue: "49150.123",
        assets: [],
      }),
    ).toThrow();
  });
});

describe("DepositAddressResponseSchema", () => {
  it("parses a valid deposit address", () => {
    const ok = {
      asset: "USDT",
      network: "TRON",
      networkLabel: "TRON (TRC-20)",
      address: "TXyz...",
    };
    expect(DepositAddressResponseSchema.parse(ok)).toEqual(ok);
  });
});
