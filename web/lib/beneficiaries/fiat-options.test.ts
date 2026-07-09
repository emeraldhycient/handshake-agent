import { describe, expect, it } from "vitest"
import { buildBankFiatOptions, pickDefaultCurrency } from "./fiat-options"

describe("buildBankFiatOptions", () => {
  it("keeps only enabled fiats that have a known bank country and labels them", () => {
    const options = buildBankFiatOptions([
      { code: "NGN" },
      { code: "KES" },
      { code: "XAF" }, // no known bank country → dropped
    ])
    expect(options).toEqual([
      { currency: "NGN", country: "NG", label: "Nigeria (NGN)" },
      { currency: "KES", country: "KE", label: "Kenya (KES)" },
    ])
  })

  it("falls back to NGN when config has not resolved (or nothing qualifies)", () => {
    expect(buildBankFiatOptions(undefined)).toEqual([
      { currency: "NGN", country: "NG", label: "Nigeria (NGN)" },
    ])
    expect(buildBankFiatOptions([{ code: "XAF" }])[0].currency).toBe("NGN")
  })
})

describe("pickDefaultCurrency", () => {
  const options = [
    { currency: "NGN", country: "NG", label: "Nigeria (NGN)" },
    { currency: "KES", country: "KE", label: "Kenya (KES)" },
  ]

  it("prefers the profile currency when it is a valid option", () => {
    expect(pickDefaultCurrency(options, "KES")).toBe("KES")
  })

  it("falls back to the first option when the profile currency is not offered", () => {
    expect(pickDefaultCurrency(options, "ZAR")).toBe("NGN")
    expect(pickDefaultCurrency(options, undefined)).toBe("NGN")
  })
})
