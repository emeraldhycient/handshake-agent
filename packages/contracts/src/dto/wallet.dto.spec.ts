import { describe, it, expect } from "vitest";
import {
  WalletBalancesResponseSchema,
  DepositAddressResponseSchema,
} from "./wallet.dto";

describe("WalletBalancesResponseSchema", () => {
  it("parses a valid balances payload", () => {
    const ok = {
      fiatCurrency: "NGN",
      fiatSymbol: "₦",
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
  it("accepts an optional asset logoUrl", () => {
    const ok = {
      fiatCurrency: "NGN",
      fiatSymbol: "₦",
      totalFiatValue: "49150.00",
      assets: [
        {
          symbol: "USDT",
          displayName: "Tether USD",
          network: "TRON",
          amount: "29.97",
          decimals: 6,
          fiatValue: "49150.00",
          logoUrl: "https://res.cloudinary.com/blockradar/image/upload/usdt.png",
        },
      ],
    };
    expect(WalletBalancesResponseSchema.parse(ok).assets[0].logoUrl).toBe(
      "https://res.cloudinary.com/blockradar/image/upload/usdt.png",
    );
  });
  it("rejects a non-URL logoUrl", () => {
    expect(() =>
      WalletBalancesResponseSchema.parse({
        fiatCurrency: "NGN",
        fiatSymbol: "₦",
        totalFiatValue: "49150.00",
        assets: [
          {
            symbol: "USDT",
            displayName: "Tether USD",
            network: "TRON",
            amount: "29.97",
            decimals: 6,
            logoUrl: "not-a-url",
          },
        ],
      }),
    ).toThrow();
  });
  it("rejects amounts with more than 2 decimal places", () => {
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
