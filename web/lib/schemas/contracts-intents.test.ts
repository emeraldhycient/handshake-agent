import { describe, expect, it } from "vitest"
import { IntentSchema } from "@handshake-agent/contracts"

describe("IntentSchema union", () => {
  it("accepts send_crypto", () => {
    const r = IntentSchema.safeParse({
      action: "send_crypto",
      asset: "USDT",
      amount: "25",
      network: "TRON",
      address: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4d3pVgk7r",
    })
    expect(r.success).toBe(true)
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
    expect(
      IntentSchema.safeParse({
        action: "swap",
        fromAsset: "USDT",
        toCurrency: "NGN",
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
