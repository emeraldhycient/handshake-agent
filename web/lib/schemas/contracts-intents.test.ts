import { describe, expect, it } from "vitest"
import { IntentSchema } from "@handshake-agent/contracts"

describe("IntentSchema union", () => {
  it("accepts send_crypto without a destination address", () => {
    // SECURITY (CLAUDE.md §3.1): send_crypto carries only asset + amount.
    // The destination is resolved server-side from the saved beneficiary, so
    // the NLU intent has no `address` field — an extra one is stripped, never
    // trusted as a financial parameter.
    const r = IntentSchema.safeParse({
      action: "send_crypto",
      asset: "USDT",
      cryptoAmount: "25",
      network: "TRON",
      address: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4d3pVgk7r",
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).not.toHaveProperty("address")
    }
  })
  it("accepts receive_crypto", () => {
    expect(
      IntentSchema.safeParse({
        action: "receive_crypto",
        asset: "USDT",
        network: "TRON",
      }).success
    ).toBe(true)
  })
  it("accepts swap", () => {
    // SwapIntentSchema uses toAsset (SupportedAssetSchema), not toCurrency —
    // fiat-to-crypto swaps are out of scope at launch (CLAUDE.md §3.6).
    expect(
      IntentSchema.safeParse({
        action: "swap",
        fromAsset: "USDT",
        toAsset: "BTC",
        amount: "10",
      }).success
    ).toBe(true)
  })
  it("accepts buy_ticket", () => {
    expect(
      IntentSchema.safeParse({ action: "buy_ticket", query: "Afrobeats Live" })
        .success
    ).toBe(true)
  })
  it("accepts check_balance", () => {
    expect(IntentSchema.safeParse({ action: "check_balance" }).success).toBe(
      true
    )
  })
  it("rejects unknown action", () => {
    expect(IntentSchema.safeParse({ action: "delete_account" }).success).toBe(
      false
    )
  })
})
