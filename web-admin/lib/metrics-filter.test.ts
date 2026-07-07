import { describe, expect, it } from "vitest"
import type { MetricsFilterState } from "@/types/components"

import { CURRENCY_OPTIONS, isFilterActive } from "./metrics-filter"

const BASE: MetricsFilterState = {
  presetId: "30d",
  from: "",
  to: "",
  capability: "",
  tier: "",
  currency: "",
}

describe("isFilterActive", () => {
  it("is false for the default preset with no scoping filters", () => {
    expect(isFilterActive(BASE)).toBe(false)
  })

  it("is true when a capability / tier / currency is set", () => {
    expect(isFilterActive({ ...BASE, capability: "buy" })).toBe(true)
    expect(isFilterActive({ ...BASE, tier: "tier_2" })).toBe(true)
    expect(isFilterActive({ ...BASE, currency: "NGN" })).toBe(true)
  })

  it("is true when a custom date range is chosen (presetId = custom)", () => {
    expect(isFilterActive({ ...BASE, presetId: "custom" })).toBe(true)
  })
})

describe("CURRENCY_OPTIONS", () => {
  it("leads with an All-currencies option then one per known fiat", () => {
    expect(CURRENCY_OPTIONS[0]).toEqual({ value: "", label: "All currencies" })
    expect(CURRENCY_OPTIONS.length).toBeGreaterThan(1)
    // Every non-empty option uses the same code for value + label.
    for (const opt of CURRENCY_OPTIONS.slice(1)) {
      expect(opt.value).toBe(opt.label)
      expect(opt.value).not.toBe("")
    }
  })
})
