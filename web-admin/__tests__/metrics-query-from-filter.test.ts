import { describe, expect, it } from "vitest"

import {
  metricsQueryFromFilter,
  CUSTOM_PRESET_ID,
} from "@/lib/metrics-range"
import type { MetricsFilterState } from "@/types"

const base: MetricsFilterState = {
  presetId: "30d",
  from: "",
  to: "",
  capability: "",
  tier: "",
  currency: "",
}

describe("metricsQueryFromFilter", () => {
  it("resolves a preset to a rolling window with both bounds present", () => {
    const q = metricsQueryFromFilter({ ...base, presetId: "7d" })
    expect(q.from).toBeTruthy()
    expect(q.to).toBeTruthy()
    const spanDays =
      (new Date(q.to!).getTime() - new Date(q.from!).getTime()) / 86_400_000
    expect(spanDays).toBeCloseTo(7, 1)
  })

  it("uses explicit full-day UTC bounds for a custom range (to-day inclusive)", () => {
    const q = metricsQueryFromFilter({
      ...base,
      presetId: CUSTOM_PRESET_ID,
      from: "2026-06-01",
      to: "2026-06-30",
    })
    expect(q.from).toBe("2026-06-01T00:00:00.000Z")
    expect(q.to).toBe("2026-06-30T23:59:59.999Z")
  })

  it("falls back to the preset window when custom is selected but a date is blank", () => {
    const q = metricsQueryFromFilter({
      ...base,
      presetId: CUSTOM_PRESET_ID,
      from: "2026-06-01",
      to: "",
    })
    // Not the custom bounds — a rolling 30d window (default preset days).
    expect(q.from).not.toBe("2026-06-01T00:00:00.000Z")
  })

  it("includes non-empty capability/tier/currency and omits empty ones", () => {
    const withFilters = metricsQueryFromFilter({
      ...base,
      capability: "buy",
      tier: "tier_2",
      currency: "NGN",
    })
    expect(withFilters.capability).toBe("buy")
    expect(withFilters.tier).toBe("tier_2")
    expect(withFilters.currency).toBe("NGN")

    const none = metricsQueryFromFilter(base)
    expect(none.capability).toBeUndefined()
    expect(none.tier).toBeUndefined()
    expect(none.currency).toBeUndefined()
  })
})
