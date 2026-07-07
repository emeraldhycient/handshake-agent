import { describe, expect, it } from "vitest"
import type { AdminCatalogFiat } from "@handshake-agent/contracts"

import { existingCodesFrom, toCatalogRows, toggleDiff } from "./rows"

function fiat(
  over: Partial<AdminCatalogFiat> & Pick<AdminCatalogFiat, "code">
): AdminCatalogFiat {
  return {
    symbol: "₦",
    displayName: "Nigerian Naira",
    decimals: 2,
    live: true,
    custom: false,
    ...over,
  }
}

describe("toCatalogRows", () => {
  it("maps fiats onto rows (lowercased id, decimals→rounding, nameEnquiry always false)", () => {
    const rows = toCatalogRows([
      fiat({ code: "NGN" }),
      fiat({ code: "GHS", live: false, custom: true }),
    ])
    expect(rows[0]).toEqual({
      id: "ngn",
      code: "NGN",
      symbol: "₦",
      name: "Nigerian Naira",
      rounding: 2,
      live: true,
      nameEnquiry: false,
      custom: false,
    })
    expect(rows[1].id).toBe("ghs")
    expect(rows[1].live).toBe(false)
    expect(rows[1].custom).toBe(true)
  })
  it("returns [] for an undefined catalog", () => {
    expect(toCatalogRows(undefined)).toEqual([])
  })
})

describe("toggleDiff", () => {
  it("shows Live→Off for a live row", () => {
    const [row] = toCatalogRows([fiat({ code: "NGN", live: true })])
    expect(toggleDiff(row)).toEqual([
      { field: "NGN · live", from: "Live", to: "Off" },
    ])
  })
  it("shows Off→Live for a disabled row", () => {
    const [row] = toCatalogRows([fiat({ code: "GHS", live: false })])
    expect(toggleDiff(row)).toEqual([
      { field: "GHS · live", from: "Off", to: "Live" },
    ])
  })
  it("returns [] for no pending row", () => {
    expect(toggleDiff(null)).toEqual([])
  })
})

describe("existingCodesFrom", () => {
  it("collects the catalog codes", () => {
    expect(
      existingCodesFrom([fiat({ code: "NGN" }), fiat({ code: "USD" })])
    ).toEqual(["NGN", "USD"])
  })
  it("returns [] for an undefined catalog", () => {
    expect(existingCodesFrom(undefined)).toEqual([])
  })
})
