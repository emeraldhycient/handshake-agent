import { describe, expect, it } from "vitest"

import { resolveCurrency } from "./money-trend"

describe("resolveCurrency", () => {
  const currencies = ["GHS", "NGN", "USD"]

  it("keeps the chosen currency when it is still in the list", () => {
    expect(resolveCurrency("NGN", currencies)).toBe("NGN")
  })

  it("falls back to the first currency when none is chosen", () => {
    expect(resolveCurrency(null, currencies)).toBe("GHS")
  })

  it("falls back to the first currency when the choice went stale", () => {
    // e.g. the range changed and the previously-chosen currency vanished.
    expect(resolveCurrency("KES", currencies)).toBe("GHS")
  })
})
