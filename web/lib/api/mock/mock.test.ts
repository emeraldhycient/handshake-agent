import { describe, expect, it } from "vitest"
import * as mock from "./index"
import { BalanceViewSchema } from "@/lib/schemas"

describe("mock api", () => {
  it("getBalances returns schema-valid data", async () => {
    const b = await mock.getBalances()
    expect(() => BalanceViewSchema.parse(b)).not.toThrow()
  })
  it("createQuote('buy') returns a quote", async () => {
    expect(await mock.createQuote("buy")).toMatchObject({
      kind: "quote",
      receiveAmt: "29.97 USDT",
    })
  })
  it("executeTransaction returns a receipt and is idempotent", async () => {
    const a = await mock.executeTransaction("buy", "key-1")
    const b = await mock.executeTransaction("buy", "key-1")
    expect(a).toEqual(b)
  })

  it("createQuote rejects for 'balance' action", async () => {
    await expect(mock.createQuote("balance")).rejects.toThrow(/no quote/i)
  })

  it("createQuote rejects for 'receive' action", async () => {
    await expect(mock.createQuote("receive")).rejects.toThrow(/no quote/i)
  })

  it("createQuote rejects for 'ticket' action", async () => {
    await expect(mock.createQuote("ticket")).rejects.toThrow(/no quote/i)
  })
})
