import { describe, expect, it } from "vitest"
import { mapDepositAddress } from "./deposit"
import type { DepositAddressResponse } from "@handshake-agent/contracts"

describe("mapDepositAddress", () => {
  it("maps to a DepositView, defaulting min/eta placeholders", () => {
    const res: DepositAddressResponse = {
      asset: "USDT",
      network: "TRON",
      networkLabel: "TRON · TRC-20",
      address: "TADDR",
    }
    const v = mapDepositAddress(res)
    expect(v).toMatchObject({
      kind: "receive",
      asset: "USDT",
      network: "TRON · TRC-20",
      address: "TADDR",
      creditedEta: "~1 min",
    })
    expect(v.minDeposit).toBe("1 USDT")
  })

  it("uses a provided minDeposit when present", () => {
    const v = mapDepositAddress({
      asset: "USDT",
      network: "TRON",
      networkLabel: "TRON · TRC-20",
      address: "TADDR",
      minDeposit: "5",
    })
    expect(v.minDeposit).toBe("5 USDT")
  })
})
