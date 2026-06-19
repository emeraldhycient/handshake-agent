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
})
