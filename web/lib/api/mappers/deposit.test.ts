import { describe, expect, it } from "vitest"
import { mapDepositAddress } from "./deposit"
import type { DepositAddressResponse } from "@handshake-agent/contracts"

describe("mapDepositAddress", () => {
  it("emits EMPTY min/eta when the backend provides none (never fabricates)", () => {
    // Finding #9: the old mapper invented "1 USDT" / "~1 min" placeholders that
    // disagreed with the chat path's "—" / "~30 min". A min-deposit and credited
    // ETA must come from one real source or be omitted — never two divergent
    // fabrications. Empty string lets the card hide the chip.
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
      minDeposit: "",
      creditedEta: "",
    })
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
