import { describe, expect, it } from "vitest"
import { WalletAssetSchema } from "./wallet"

// ─── WalletAssetSchema ────────────────────────────────────────────────────────

describe("WalletAssetSchema", () => {
  it("parses a valid wallet asset", () => {
    expect(
      WalletAssetSchema.safeParse({
        sym: "USDT",
        name: "Tether",
        sub: "TRC-20",
        amount: "120.50 USDT",
        value: "₦72,300",
        change: "+0.01%",
        tint: "#7fd1a8",
      }).success
    ).toBe(true)
  })

  it("rejects a wallet asset missing tint", () => {
    expect(
      WalletAssetSchema.safeParse({
        sym: "USDT",
        name: "Tether",
        sub: "TRC-20",
        amount: "120.50 USDT",
        value: "₦72,300",
        change: "+0.01%",
        // tint omitted
      }).success
    ).toBe(false)
  })

  it("rejects a wallet asset missing sub", () => {
    expect(
      WalletAssetSchema.safeParse({
        sym: "BTC",
        name: "Bitcoin",
        amount: "0.002 BTC",
        value: "₦12,000",
        change: "-1.2%",
        tint: "#f5c46b",
        // sub omitted
      }).success
    ).toBe(false)
  })

  it("rejects a wallet asset missing change", () => {
    expect(
      WalletAssetSchema.safeParse({
        sym: "NGN",
        name: "Nigerian Naira",
        sub: "Native",
        amount: "5,000 NGN",
        value: "₦5,000",
        tint: "#cfe6d8",
        // change omitted
      }).success
    ).toBe(false)
  })
})
