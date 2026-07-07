import { describe, expect, it } from "vitest"

import {
  ADD_PRICE_DEFAULTS,
  AddPriceFormSchema,
} from "./add-price-schema"

function firstError(input: unknown): string | undefined {
  const result = AddPriceFormSchema.safeParse(input)
  return result.success ? undefined : result.error.issues[0]?.message
}

describe("AddPriceFormSchema", () => {
  it("accepts a valid pair + rate and coerces the rate from a string", () => {
    const parsed = AddPriceFormSchema.parse({
      asset: "USDT",
      code: "NGN",
      rate: "1500.5",
    })
    expect(parsed).toEqual({ asset: "USDT", code: "NGN", rate: 1500.5 })
  })

  it("requires an asset", () => {
    expect(firstError({ asset: "", code: "NGN", rate: 1500 })).toBe(
      "Select an asset"
    )
  })

  it("requires a currency", () => {
    expect(firstError({ asset: "USDT", code: "", rate: 1500 })).toBe(
      "Select a currency"
    )
  })

  it("rejects a non-positive rate (incl. the 0 default)", () => {
    expect(firstError({ asset: "USDT", code: "NGN", rate: 0 })).toBe(
      "Enter a positive rate"
    )
    expect(firstError({ asset: "USDT", code: "NGN", rate: -3 })).toBe(
      "Enter a positive rate"
    )
  })

  it("rejects a non-numeric rate", () => {
    expect(firstError({ asset: "USDT", code: "NGN", rate: "abc" })).toBe(
      "Enter a rate"
    )
  })

  it("exposes an all-empty default that fails validation until filled", () => {
    expect(ADD_PRICE_DEFAULTS).toEqual({ asset: "", code: "", rate: 0 })
    expect(AddPriceFormSchema.safeParse(ADD_PRICE_DEFAULTS).success).toBe(false)
  })
})
