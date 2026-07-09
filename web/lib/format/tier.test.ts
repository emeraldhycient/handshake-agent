import { describe, expect, it } from "vitest"
import { tierLabel } from "./tier"

describe("tierLabel", () => {
  it("maps unverified to a friendly label", () => {
    expect(tierLabel("unverified")).toBe("Unverified")
  })

  it("maps tier_N to 'Tier N'", () => {
    expect(tierLabel("tier_1")).toBe("Tier 1")
    expect(tierLabel("tier_2")).toBe("Tier 2")
  })
})
