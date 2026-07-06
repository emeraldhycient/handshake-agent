import { describe, expect, it } from "vitest"
import { assetNetwork, depositableAssets, networkMatches } from "./deposit"
import type { WalletAsset, DepositView } from "@/lib/schemas"

const usdt = {
  sym: "USDT",
  name: "Tether USD",
  sub: "USDT · TRON",
} as WalletAsset
const btc = { sym: "BTC", name: "Bitcoin", sub: "BTC · Bitcoin" } as WalletAsset
const naira = { sym: "NGN", name: "Naira", sub: "NGN balance" } as WalletAsset

const tronDeposit = {
  address: "TQn9",
  network: "TRON · TRC-20",
} as DepositView

describe("wallet deposit helpers", () => {
  describe("assetNetwork", () => {
    it("extracts the network token after the separator", () => {
      expect(assetNetwork(usdt)).toBe("TRON")
    })
    it("returns null for fiat balances", () => {
      expect(assetNetwork(naira)).toBeNull()
    })
  })

  describe("depositableAssets", () => {
    it("excludes fiat balances", () => {
      expect(depositableAssets([usdt, btc, naira])).toEqual([usdt, btc])
    })
  })

  describe("networkMatches", () => {
    it("matches when the asset network is a substring of the deposit network", () => {
      expect(networkMatches(usdt, tronDeposit)).toBe(true)
    })
    it("does not match an asset on a different network", () => {
      expect(networkMatches(btc, tronDeposit)).toBe(false)
    })
    it("returns false when there is no deposit", () => {
      expect(networkMatches(usdt, undefined)).toBe(false)
    })
  })
})
