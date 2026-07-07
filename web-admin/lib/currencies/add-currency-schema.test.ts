import { describe, expect, it } from "vitest"

import { AddCurrencyFormSchema } from "./add-currency-schema"

const valid = {
  code: "ghs",
  displayName: "Ghanaian Cedi",
  symbol: "₵",
  decimals: "2",
}

describe("AddCurrencyFormSchema", () => {
  it("trims + upper-cases the code and coerces decimals to a number", () => {
    const parsed = AddCurrencyFormSchema.parse({ ...valid, code: "  ghs  " })
    expect(parsed.code).toBe("GHS")
    expect(parsed.decimals).toBe(2)
  })
  it("rejects a non-3-letter code", () => {
    expect(
      AddCurrencyFormSchema.safeParse({ ...valid, code: "GH" }).success
    ).toBe(false)
  })
  it("requires a display name and a symbol", () => {
    expect(
      AddCurrencyFormSchema.safeParse({ ...valid, displayName: "" }).success
    ).toBe(false)
    expect(
      AddCurrencyFormSchema.safeParse({ ...valid, symbol: "" }).success
    ).toBe(false)
  })
  it("bounds decimals to a 0–8 integer", () => {
    expect(
      AddCurrencyFormSchema.safeParse({ ...valid, decimals: "9" }).success
    ).toBe(false)
    expect(
      AddCurrencyFormSchema.safeParse({ ...valid, decimals: "1.5" }).success
    ).toBe(false)
    expect(
      AddCurrencyFormSchema.safeParse({ ...valid, decimals: "0" }).success
    ).toBe(true)
  })
})
