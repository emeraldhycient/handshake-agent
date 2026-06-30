import { describe, expect, it } from "vitest"
import { mapWalletBalances, mapWalletAssets } from "./wallet"
import type { WalletBalancesResponse } from "@handshake-agent/contracts"

const res: WalletBalancesResponse = {
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
}

describe("mapWalletBalances", () => {
  it("produces a BalanceView with an approx total and per-asset rows", () => {
    const v = mapWalletBalances(res)
    expect(v.kind).toBe("balance")
    expect(v.total).toBe("≈ ₦49,150")
    expect(v.assets[0]).toMatchObject({
      sym: "USDT",
      name: "Tether USD",
      amount: "29.97 USDT",
      value: "₦49,150",
    })
    expect(v.assets[0].tint).toBe("#7fd1a8")
  })
})

describe("mapWalletAssets", () => {
  it("adds the network sub-label and a placeholder change", () => {
    const rows = mapWalletAssets(res)
    expect(rows[0]).toMatchObject({
      sym: "USDT",
      sub: "USDT · TRON",
      amount: "29.97 USDT",
      value: "₦49,150",
    })
    expect(typeof rows[0].change).toBe("string")
  })
})
