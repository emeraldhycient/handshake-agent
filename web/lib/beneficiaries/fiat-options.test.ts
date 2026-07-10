import { describe, expect, it } from "vitest"
import { buildBankFiatOptions, pickDefaultCurrency } from "./fiat-options"

describe("buildBankFiatOptions", () => {
  it("derives country from the /config fiats and drops any without a country mapping", () => {
    const options = buildBankFiatOptions([
      { code: "NGN", country: "NG" },
      { code: "KES", country: "KE" },
      { code: "XAF" }, // /config carries no country → dropped
    ])
    expect(options).toEqual([
      { currency: "NGN", country: "NG", label: "Nigeria (NGN)" },
      { currency: "KES", country: "KE", label: "Kenya (KES)" },
    ])
  })

  it("labels an unknown-country code with the raw country when config supplies one", () => {
    // A future /config country without a display-name entry still labels sanely.
    expect(buildBankFiatOptions([{ code: "AOA", country: "AO" }])).toEqual([
      { currency: "AOA", country: "AO", label: "AO (AOA)" },
    ])
  })

  it("falls back to NGN/NG when config has not resolved (or nothing qualifies)", () => {
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
