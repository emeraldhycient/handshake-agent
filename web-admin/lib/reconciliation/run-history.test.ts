import { describe, expect, it } from "vitest"

import { formatRunDate, isActionable } from "./run-history"

describe("isActionable", () => {
  it("is true only for non-terminal break statuses", () => {
    expect(isActionable("detected")).toBe(true)
    expect(isActionable("acknowledged")).toBe(true)
    expect(isActionable("resolved")).toBe(false)
    expect(isActionable("rejected")).toBe(false)
  })
})

describe("formatRunDate", () => {
  it("formats a valid ISO date via toLocaleString", () => {
    const iso = "2026-07-02T00:00:00.000Z"
    expect(formatRunDate(iso)).toBe(new Date(iso).toLocaleString())
  })
  it("falls back to the raw string for an unparseable value", () => {
    expect(formatRunDate("nope")).toBe("nope")
  })
})
