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

const resWithLogo: WalletBalancesResponse = {
  ...res,
  assets: [
    {
      ...res.assets[0],
      logoUrl: "https://res.cloudinary.com/blockradar/usdt.png",
    },
  ],
}

// Finding #7: a wallet holding real (unpriced) assets must not read the same as
// an empty ₦0 wallet. When a contributing asset has no fiatValue the total is
// "value unavailable", not "≈ ₦0".
const resUnpriced: WalletBalancesResponse = {
  fiatCurrency: "NGN",
  fiatSymbol: "₦",
  // The service sums only priced assets, so an all-unpriced wallet reports 0.00.
  totalFiatValue: "0.00",
  assets: [
    {
      symbol: "TRX",
      displayName: "TRON",
      network: "TRON",
      amount: "1000",
      decimals: 6,
      // no fiatValue — no FX rate available for TRX
    },
  ],
}

const resPartiallyPriced: WalletBalancesResponse = {
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
    {
      symbol: "TRX",
      displayName: "TRON",
      network: "TRON",
      amount: "1000",
      decimals: 6,
      // no fiatValue — total is therefore only partial
    },
  ],
}

const resEmpty: WalletBalancesResponse = {
  fiatCurrency: "NGN",
  fiatSymbol: "₦",
  totalFiatValue: "0.00",
  assets: [],
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

  it("threads logoUrl through when the response provides one", () => {
    const v = mapWalletBalances(resWithLogo)
    expect(v.assets[0].logoUrl).toBe(
      "https://res.cloudinary.com/blockradar/usdt.png"
    )
  })

  it("omits logoUrl when the response has none", () => {
    const v = mapWalletBalances(res)
    expect(v.assets[0].logoUrl).toBeUndefined()
  })

  it("a real holding with no FX rate shows 'value unavailable', NOT '≈ ₦0' (finding #7)", () => {
    const v = mapWalletBalances(resUnpriced)
    // Must be distinguishable from a true zero/empty wallet.
    expect(v.total).not.toBe("≈ ₦0")
    expect(v.total).toContain("—")
    // The per-asset row still shows the held amount but no fiat value.
    expect(v.assets[0]).toMatchObject({ amount: "1000 TRX", value: "—" })
  })

  it("a partially-priced wallet flags the total as unavailable (it is only partial)", () => {
    const v = mapWalletBalances(resPartiallyPriced)
    expect(v.total).not.toBe("≈ ₦49,150")
    expect(v.total).toContain("—")
  })

  it("a genuinely empty wallet still shows ≈ ₦0 (NOT unavailable)", () => {
    const v = mapWalletBalances(resEmpty)
    expect(v.total).toBe("≈ ₦0")
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

  it("threads logoUrl through when the response provides one", () => {
    const rows = mapWalletAssets(resWithLogo)
    expect(rows[0].logoUrl).toBe(
      "https://res.cloudinary.com/blockradar/usdt.png"
    )
  })

  it("omits logoUrl when the response has none", () => {
    const rows = mapWalletAssets(res)
    expect(rows[0].logoUrl).toBeUndefined()
  })
})
