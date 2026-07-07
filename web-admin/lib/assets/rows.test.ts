import { describe, expect, it } from "vitest"
import type { AdminCatalogView } from "@handshake-agent/contracts"

import { assetEnabledKey, assetKey, toAssetRow } from "./rows"

type CatalogAsset = AdminCatalogView["assets"][number]

const ASSET: CatalogAsset = {
  symbol: "USDT",
  displayName: "Tether USD",
  networks: ["TRON"],
  decimals: 6,
  logoUrl: "https://cdn/usdt.png",
  live: true,
} as CatalogAsset

describe("toAssetRow", () => {
  it("maps symbol/name/chain/decimals/logo/live, em-dashes min-max + contract", () => {
    const row = toAssetRow(ASSET)
    expect(row.sym).toBe("USDT")
    expect(row.name).toBe("Tether USD")
    expect(row.chain).toBe("TRON")
    expect(row.dec).toBe(6)
    expect(row.minmax).toBe("—")
    expect(row.contract).toBe("—")
    expect(row.live).toBe(true)
  })
  it("em-dashes the chain when no networks are listed", () => {
    expect(toAssetRow({ ...ASSET, networks: [] }).chain).toBe("—")
  })
})

describe("assetKey + assetEnabledKey", () => {
  it("keys a row by ticker+chain and its enabled setting leaf", () => {
    const row = toAssetRow(ASSET)
    expect(assetKey(row)).toBe("USDT-TRON")
    expect(assetEnabledKey(row)).toBe("catalog.assets.USDT.enabled")
  })
})
